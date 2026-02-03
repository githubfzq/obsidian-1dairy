import type { PdfImage } from './types';

// pdfjs-dist OPS 常量 (避免直接导入内部模块)
const PDF_OPS = {
	paintJpegXObject: 82,
	paintImageXObject: 85,
	paintImageMaskXObject: 83
};

/**
 * 从页面对象获取图片数据
 * 因为已经渲染过页面，图片对象应该都已加载，可以直接同步获取
 */
async function getImageDataFromPage(page: any, imageName: string): Promise<any> {
	// 方法1: 同步检查 page.objs（渲染后应该已加载）
	if (page.objs.has(imageName)) {
		const data = page.objs.get(imageName);
		if (data) {
			return data;
		}
	}

	// 方法2: 检查 commonObjs（某些图片可能在全局对象中）
	if (page.commonObjs && page.commonObjs.has(imageName)) {
		const data = page.commonObjs.get(imageName);
		if (data) {
			return data;
		}
	}

	// 方法3: 异步等待加载（作为备用方案，但应该很少走到这里）
	return new Promise((resolve) => {
		let resolved = false;

		// 设置较短的超时时间，因为图片应该已经加载
		const timer = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				console.debug(`图片 ${imageName} 即使渲染后仍未加载`);
				resolve(null);
			}
		}, 1000);

		try {
			page.objs.get(imageName, (data: any) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					resolve(data || null);
				}
			});
		} catch (error) {
			if (!resolved) {
				resolved = true;
				clearTimeout(timer);
				console.debug(`获取图片 ${imageName} 异常:`, error);
				resolve(null);
			}
		}
	});
}

/**
 * 检测是否是 JPEG 数据
 */
function isJpegData(data: Uint8Array): boolean {
	// JPEG 文件以 FFD8FF 开头
	return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

/**
 * 将 pdfjs 图片数据转换为标准格式
 */
async function convertImageData(imgData: any): Promise<{
	data: Uint8Array;
	format: string;
	width: number;
	height: number;
} | null> {
	try {
		const width = imgData.width;
		const height = imgData.height;

		// 如果已经是 JPEG 数据（通过 data URL 或直接的 JPEG 数据）
		if (imgData.data instanceof Uint8Array && isJpegData(imgData.data)) {
			return {
				data: imgData.data,
				format: 'jpeg',
				width,
				height
			};
		}

		// 否则需要转换为 PNG
		// 创建 canvas 来处理图片数据
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');

		if (!ctx) {
			console.warn('无法创建 canvas context');
			return null;
		}

		// 创建 ImageData
		let imageData: ImageData;

		if (imgData.data instanceof Uint8ClampedArray) {
			// 直接是 RGBA 数据
			imageData = new ImageData(imgData.data, width, height);
		} else if (imgData.data instanceof Uint8Array) {
			// 可能是 RGB 数据，需要转换为 RGBA
			const data = imgData.data;
			const hasAlpha = data.length === width * height * 4;

			if (hasAlpha) {
				imageData = new ImageData(new Uint8ClampedArray(data), width, height);
			} else {
				// RGB 转 RGBA
				const rgba = new Uint8ClampedArray(width * height * 4);
				const pixelCount = width * height;

				for (let j = 0; j < pixelCount; j++) {
					rgba[j * 4] = data[j * 3]; // R
					rgba[j * 4 + 1] = data[j * 3 + 1]; // G
					rgba[j * 4 + 2] = data[j * 3 + 2]; // B
					rgba[j * 4 + 3] = 255; // A
				}

				imageData = new ImageData(rgba, width, height);
			}
		} else {
			console.warn('未知的图片数据格式');
			return null;
		}

		ctx.putImageData(imageData, 0, 0);

		// 转换为 PNG blob
		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob((b) => resolve(b), 'image/png');
		});

		if (!blob) {
			console.warn('无法创建图片 blob');
			return null;
		}

		const arrayBuffer = await blob.arrayBuffer();
		return {
			data: new Uint8Array(arrayBuffer),
			format: 'png',
			width,
			height
		};
	} catch (error) {
		console.warn('图片数据转换失败:', error);
		return null;
	}
}

/**
 * 从页面提取图片
 * 关键改进：先渲染页面以确保所有图片对象都被加载到内存
 */
export async function extractImagesFromPage(page: any, pageNum: number): Promise<PdfImage[]> {
	const images: PdfImage[] = [];

	try {
		// 关键步骤：先渲染页面到一个小的 canvas，这会触发所有资源（包括图片）的加载
		const viewport = page.getViewport({ scale: 0.1 });
		const canvas = document.createElement('canvas');
		canvas.width = Math.floor(viewport.width);
		canvas.height = Math.floor(viewport.height);
		const context = canvas.getContext('2d', { willReadFrequently: false });

		if (context) {
			await page.render({
				canvasContext: context,
				viewport: viewport
			}).promise;
		}

		const operatorList = await page.getOperatorList();
		const operators = operatorList.fnArray;
		const args = operatorList.argsArray;

		// 收集所有图片名称
		const imageNames: string[] = [];
		for (let i = 0; i < operators.length; i++) {
			const op = operators[i];
			if (
				op === PDF_OPS.paintImageXObject ||
				op === PDF_OPS.paintJpegXObject ||
				op === PDF_OPS.paintImageMaskXObject
			) {
				const imageName = args[i][0];
				if (imageName && !imageNames.includes(imageName)) {
					imageNames.push(imageName);
				}
			}
		}

		// 逐个提取图片
		for (let idx = 0; idx < imageNames.length; idx++) {
			const imageName = imageNames[idx];

			try {
				const imgData = await getImageDataFromPage(page, imageName);
				if (imgData && (imgData.data || imgData.bitmap)) {
					const imageInfo = await convertImageData(imgData);
					if (imageInfo) {
						images.push({
							data: imageInfo.data,
							format: imageInfo.format,
							width: imgData.width || imageInfo.width,
							height: imgData.height || imageInfo.height,
							pageNum: pageNum,
							imageIndex: idx
						});
					}
				} else {
					console.debug(`页面 ${pageNum} 图片 ${imageName} 数据无效`);
				}
			} catch (imgError) {
				console.warn(`页面 ${pageNum} 图片 ${imageName} 提取失败:`, imgError);
			}
		}
	} catch (error) {
		console.warn(`页面 ${pageNum} 图片提取失败:`, error);
	}

	return images;
}
