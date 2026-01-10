import { App, Modal, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { OneDiarySettings, DEFAULT_SETTINGS, DiaryEntry, PdfImage } from './types';
import { parseTxtDiary, parsePdfDiary, diaryToMarkdown, generateFileName } from './parser';
import { OneDiarySettingTab } from './settings';
// @ts-ignore - pdfjs-dist types may not be perfect
import * as pdfjsLib from 'pdfjs-dist';

// pdfjs-dist OPS 常量 (避免直接导入内部模块)
const PDF_OPS = {
	paintJpegXObject: 82,
	paintImageXObject: 85,
	paintImageMaskXObject: 83
};

export default class OneDiaryPlugin extends Plugin {
	settings: OneDiarySettings;

	async onload() {
		await this.loadSettings();

		// 添加导入命令
		this.addCommand({
			id: 'import-txt-diary',
			name: '导入 TXT 格式日记',
			callback: () => {
				new ImportModal(this.app, this).open();
			}
		});

		// 添加 PDF 导入命令
		this.addCommand({
			id: 'import-pdf-diary',
			name: '导入 PDF 格式日记',
			callback: () => {
				new ImportPdfModal(this.app, this).open();
			}
		});

		// 添加设置选项卡
		this.addSettingTab(new OneDiarySettingTab(this.app, this));

		// 添加 Ribbon 图标
		this.addRibbonIcon('book-open', '导入 1Diary 日记', () => {
			new ImportModal(this.app, this).open();
		});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * 解析现有 Markdown 文件，提取 frontmatter 和 body
	 */
	private parseMarkdownFile(content: string): { frontmatter: string; body: string } {
		const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
		const match = content.match(frontmatterRegex);
		
		if (match) {
			const frontmatter = match[0]; // 包含 --- 分隔符
			const body = content.substring(match[0].length).trim();
			return { frontmatter, body };
		}
		
		// 如果没有 frontmatter，返回空 frontmatter 和整个内容作为 body
		return { frontmatter: '', body: content.trim() };
	}

	/**
	 * 合并同一天的日记条目内容
	 */
	private mergeDiaryContent(existingContent: string, newEntry: DiaryEntry): string {
		const { frontmatter, body } = this.parseMarkdownFile(existingContent);
		
		// 生成新条目的内容部分（不包含 frontmatter 和标题）
		const newEntryContent = newEntry.content.trim();
		
		if (!newEntryContent) {
			// 如果新条目没有内容，直接返回现有内容
			return existingContent;
		}
		
		// 构建合并后的内容
		const separator = '\n\n***\n\n'; // 使用水平分隔符区分不同条目
		
		let mergedContent = '';
		if (frontmatter) {
			// 如果有 frontmatter，保持它
			mergedContent = frontmatter + '\n';
		}
		
		// 追加现有 body
		if (body) {
			mergedContent += body;
			// 如果 body 不为空，添加分隔符
			mergedContent += separator;
		}
		
		// 追加新条目内容
		mergedContent += newEntryContent;
		
		return mergedContent;
	}

	/**
	 * 导入日记条目到 Obsidian
	 */
	async importEntries(entries: DiaryEntry[], groupByYear?: boolean): Promise<{ success: number; skipped: number; errors: string[] }> {
		const result = { success: 0, skipped: 0, errors: [] as string[] };
		const vault = this.app.vault;
		
		// 使用传入的参数，如果没有则使用全局设置
		const shouldGroupByYear = groupByYear !== undefined ? groupByYear : this.settings.groupByYear;

		// 确保输出目录存在
		await this.ensureFolder(this.settings.outputFolder);

		for (const entry of entries) {
			try {
				// 构建文件路径
				let folderPath = this.settings.outputFolder;
				if (shouldGroupByYear) {
					const year = entry.date.substring(0, 4);
					folderPath = `${this.settings.outputFolder}/${year}`;
					await this.ensureFolder(folderPath);
				}

				const fileName = generateFileName(entry, this.settings.dateFormat);
				const filePath = `${folderPath}/${fileName}`;

				// 检查文件是否已存在
				const existingFile = vault.getAbstractFileByPath(filePath);
				if (existingFile && existingFile instanceof TFile) {
					// 文件已存在，合并内容
					const existingContent = await vault.read(existingFile);
					const mergedContent = this.mergeDiaryContent(existingContent, entry);
					await vault.modify(existingFile, mergedContent);
					result.success++;
				} else {
					// 文件不存在，创建新文件
					const markdown = diaryToMarkdown(entry, this.settings.addTitle);
					await vault.create(filePath, markdown);
					result.success++;
				}

			} catch (error) {
				result.errors.push(`${entry.date}: ${error.message}`);
			}
		}

		// 更新上次导入时间
		this.settings.lastImportTime = Date.now();
		await this.saveSettings();

		return result;
	}

	/**
	 * 确保文件夹存在
	 */
	private async ensureFolder(path: string): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(path);
		if (!folder) {
			await this.app.vault.createFolder(path);
		}
	}

	/**
	 * 导入日记条目和关联的图片
	 */
	async importEntriesWithImages(
		entries: DiaryEntry[],
		pageImages: Map<number, PdfImage[]>,
		pageToDate: Map<number, string>
	): Promise<{ success: number; skipped: number; errors: string[]; imagesImported: number }> {
		const result = { success: 0, skipped: 0, errors: [] as string[], imagesImported: 0 };
		const vault = this.app.vault;

		// 确保输出目录存在
		await this.ensureFolder(this.settings.outputFolder);
		
		// 确保附件目录存在
		if (this.settings.importAttachments) {
			await this.ensureFolder(this.settings.attachmentFolder);
		}

		// 首先保存所有图片
		if (this.settings.importAttachments && pageImages.size > 0) {
			for (const [pageNum, images] of pageImages) {
				const date = pageToDate.get(pageNum);
				if (!date) continue;

				for (let idx = 0; idx < images.length; idx++) {
					const img = images[idx];
					const imageName = `diary-${date}-p${pageNum}-${idx}.${img.format}`;
					const imagePath = `${this.settings.attachmentFolder}/${imageName}`;

					try {
						// 检查图片是否已存在
						const existingFile = vault.getAbstractFileByPath(imagePath);
						if (!existingFile) {
							// 保存图片文件 - 将 Uint8Array 转换为 ArrayBuffer
							const arrayBuffer = new ArrayBuffer(img.data.length);
							new Uint8Array(arrayBuffer).set(img.data);
							await vault.createBinary(imagePath, arrayBuffer);
							result.imagesImported++;
						}
					} catch (error) {
						console.warn(`保存图片失败: ${imagePath}`, error);
						result.errors.push(`图片 ${imageName}: ${(error as Error).message}`);
					}
				}
			}
		}

		// 导入日记条目
		for (const entry of entries) {
			try {
				// 构建文件路径
				let folderPath = this.settings.outputFolder;
				if (this.settings.groupByYear) {
					const year = entry.date.substring(0, 4);
					folderPath = `${this.settings.outputFolder}/${year}`;
					await this.ensureFolder(folderPath);
				}

				const fileName = generateFileName(entry, this.settings.dateFormat);
				const filePath = `${folderPath}/${fileName}`;

				// 检查文件是否已存在
				const existingFile = vault.getAbstractFileByPath(filePath);
				if (existingFile && existingFile instanceof TFile) {
					// 文件已存在，合并内容
					const existingContent = await vault.read(existingFile);
					const mergedContent = this.mergeDiaryContentWithAttachments(existingContent, entry);
					await vault.modify(existingFile, mergedContent);
					result.success++;
				} else {
					// 文件不存在，创建新文件
					const markdown = diaryToMarkdown(entry, this.settings.addTitle);
					await vault.create(filePath, markdown);
					result.success++;
				}

			} catch (error) {
				result.errors.push(`${entry.date}: ${error.message}`);
			}
		}

		// 更新上次导入时间
		this.settings.lastImportTime = Date.now();
		await this.saveSettings();

		return result;
	}

	/**
	 * 合并日记内容（包含附件）
	 */
	private mergeDiaryContentWithAttachments(existingContent: string, newEntry: DiaryEntry): string {
		const { frontmatter, body } = this.parseMarkdownFile(existingContent);
		
		const newEntryContent = newEntry.content.trim();
		
		if (!newEntryContent && (!newEntry.attachments || newEntry.attachments.length === 0)) {
			return existingContent;
		}
		
		const separator = '\n\n***\n\n';
		
		let mergedContent = '';
		if (frontmatter) {
			mergedContent = frontmatter + '\n';
		}
		
		if (body) {
			mergedContent += body;
			if (newEntryContent) {
				mergedContent += separator;
			}
		}
		
		if (newEntryContent) {
			mergedContent += newEntryContent;
		}
		
		// 添加附件（如果有新的附件）
		if (newEntry.attachments && newEntry.attachments.length > 0) {
			// 检查现有内容中是否已有附件部分
			if (!mergedContent.includes('## 附件')) {
				mergedContent += '\n\n## 附件';
			}
			for (const attachment of newEntry.attachments) {
				// 避免重复添加
				if (!mergedContent.includes(`![[${attachment}]]`)) {
					mergedContent += `\n![[${attachment}]]`;
				}
			}
		}
		
		return mergedContent;
	}
}

/**
 * 导入对话框
 */
class ImportModal extends Modal {
	plugin: OneDiaryPlugin;
	fileContent: string | null = null;

	constructor(app: App, plugin: OneDiaryPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '导入 1Diary 日记' });

		// 文件选择区域
		const dropZone = contentEl.createDiv({ cls: 'one-diary-drop-zone' });
		dropZone.createEl('p', { text: '点击选择文件或拖拽 TXT 文件到此处' });
		
		// 文件输入
		const fileInput = dropZone.createEl('input', {
			type: 'file',
			attr: { accept: '.txt' }
		});
		fileInput.style.display = 'none';

		dropZone.addEventListener('click', () => fileInput.click());
		
		// 拖拽支持
		dropZone.addEventListener('dragover', (e) => {
			e.preventDefault();
			dropZone.addClass('drag-over');
		});
		
		dropZone.addEventListener('dragleave', () => {
			dropZone.removeClass('drag-over');
		});
		
		dropZone.addEventListener('drop', async (e) => {
			e.preventDefault();
			dropZone.removeClass('drag-over');
			const file = e.dataTransfer?.files[0];
			if (file) {
				await this.handleFile(file, dropZone);
			}
		});

		fileInput.addEventListener('change', async () => {
			const file = fileInput.files?.[0];
			if (file) {
				await this.handleFile(file, dropZone);
			}
		});

		// 预览区域
		const previewEl = contentEl.createDiv({ cls: 'one-diary-preview' });
		previewEl.style.display = 'none';

		// 导入按钮
		const buttonContainer = contentEl.createDiv({ cls: 'one-diary-buttons' });
		const importBtn = buttonContainer.createEl('button', {
			text: '开始导入',
			cls: 'mod-cta'
		});
		importBtn.disabled = true;

		importBtn.addEventListener('click', async () => {
			if (!this.fileContent) return;

			importBtn.disabled = true;
			importBtn.textContent = '导入中...';

			try {
				const { entries, errors } = parseTxtDiary(this.fileContent);
				
				if (errors.length > 0) {
					new Notice(`解析警告: ${errors.length} 个问题`);
				}

				if (entries.length === 0) {
					new Notice('未找到有效的日记条目');
					return;
				}

				const result = await this.plugin.importEntries(entries);
				
				new Notice(
					`导入完成!\n成功: ${result.success} 篇\n跳过: ${result.skipped} 篇` +
					(result.errors.length > 0 ? `\n错误: ${result.errors.length} 个` : '')
				);

				this.close();
			} catch (error) {
				new Notice(`导入失败: ${error.message}`);
			} finally {
				importBtn.disabled = false;
				importBtn.textContent = '开始导入';
			}
		});

		// 取消按钮
		const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
		cancelBtn.addEventListener('click', () => this.close());

		// 存储引用以便更新
		(this as any).previewEl = previewEl;
		(this as any).importBtn = importBtn;
	}

	async handleFile(file: File, dropZone: HTMLElement) {
		const importBtn = (this as any).importBtn as HTMLButtonElement;
		const previewEl = (this as any).previewEl as HTMLElement;

		// 显示加载动画
		dropZone.empty();
		dropZone.addClass('loading');
		const loadingEl = dropZone.createDiv({ cls: 'one-diary-loading' });
		loadingEl.createDiv({ cls: 'one-diary-spinner' });
		loadingEl.createEl('p', { text: '正在解析文件...', cls: 'one-diary-loading-text' });

		try {
			this.fileContent = await file.text();
			const { entries } = parseTxtDiary(this.fileContent);

			// 解析完成，移除加载状态
			dropZone.removeClass('loading');
			dropZone.empty();
			dropZone.createEl('p', { text: `✓ 已选择: ${file.name}` });
			dropZone.createEl('p', { text: `找到 ${entries.length} 篇日记`, cls: 'one-diary-count' });

			// 显示预览
			if (entries.length > 0) {
				previewEl.style.display = 'block';
				previewEl.empty();
				previewEl.createEl('h4', { text: '预览 (前3篇)' });
				
				const previewList = previewEl.createEl('ul');
				const addTitle = this.plugin.settings.addTitle;
				
				entries.slice(0, 3).forEach(entry => {
					const li = previewList.createEl('li');
					li.createEl('strong', { text: entry.date });
					
					// 根据设置决定是否显示标题信息
					if (addTitle) {
						li.createSpan({ text: ` - ${entry.weekday}` });
						if (entry.weather) {
							li.createSpan({ text: ` · ${entry.weather}` });
						}
						if (entry.temperature) {
							li.createSpan({ text: ` · ${entry.temperature}` });
						}
						if (entry.location) {
							li.createSpan({ text: ` · ${entry.location}` });
						}
					}
					
					li.createEl('br');
					li.createSpan({ 
						text: entry.content.substring(0, 50) + (entry.content.length > 50 ? '...' : ''),
						cls: 'one-diary-preview-content'
					});
				});

				importBtn.disabled = false;
			}
		} catch (error) {
			dropZone.removeClass('loading');
			dropZone.empty();
			dropZone.createEl('p', { text: '点击选择文件或拖拽 TXT 文件到此处' });
			new Notice(`读取文件失败: ${error.message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.fileContent = null;
	}
}

/**
 * PDF 导入对话框
 */
class ImportPdfModal extends Modal {
	plugin: OneDiaryPlugin;
	pdfText: string | null = null;
	/** 按页码存储的图片数据 */
	pageImages: Map<number, PdfImage[]> = new Map();
	/** 页码到日期的映射（第一次在该页出现的日期） */
	pageToDate: Map<number, string> = new Map();

	constructor(app: App, plugin: OneDiaryPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '导入 PDF 格式日记' });

		// 文件选择区域
		const dropZone = contentEl.createDiv({ cls: 'one-diary-drop-zone' });
		dropZone.createEl('p', { text: '点击选择文件或拖拽 PDF 文件到此处' });
		
		// 文件输入
		const fileInput = dropZone.createEl('input', {
			type: 'file',
			attr: { accept: '.pdf' }
		});
		fileInput.style.display = 'none';

		dropZone.addEventListener('click', () => fileInput.click());
		
		// 拖拽支持
		dropZone.addEventListener('dragover', (e) => {
			e.preventDefault();
			dropZone.addClass('drag-over');
		});
		
		dropZone.addEventListener('dragleave', () => {
			dropZone.removeClass('drag-over');
		});
		
		dropZone.addEventListener('drop', async (e) => {
			e.preventDefault();
			dropZone.removeClass('drag-over');
			const file = e.dataTransfer?.files[0];
			if (file) {
				await this.handleFile(file, dropZone);
			}
		});

		fileInput.addEventListener('change', async () => {
			const file = fileInput.files?.[0];
			if (file) {
				await this.handleFile(file, dropZone);
			}
		});

		// 预览区域
		const previewEl = contentEl.createDiv({ cls: 'one-diary-preview' });
		previewEl.style.display = 'none';

		// 导入按钮
		const buttonContainer = contentEl.createDiv({ cls: 'one-diary-buttons' });
		const importBtn = buttonContainer.createEl('button', {
			text: '开始导入',
			cls: 'mod-cta'
		});
		importBtn.disabled = true;

		importBtn.addEventListener('click', async () => {
			if (!this.pdfText) return;

			importBtn.disabled = true;
			importBtn.textContent = '导入中...';

			try {
				const { entries, errors } = parsePdfDiary(this.pdfText);
				
				if (errors.length > 0) {
					new Notice(`解析警告: ${errors.length} 个问题`);
				}

				if (entries.length === 0) {
					new Notice('未找到有效的日记条目');
					return;
				}

				// 将图片与日记条目关联
				const entriesWithImages = this.associateImagesWithEntries(entries);
				
				// 导入日记和图片
				const result = await this.plugin.importEntriesWithImages(
					entriesWithImages,
					this.pageImages,
					this.pageToDate
				);
				
				let noticeText = `导入完成!\n成功: ${result.success} 篇\n跳过: ${result.skipped} 篇`;
				if (result.imagesImported > 0) {
					noticeText += `\n图片: ${result.imagesImported} 张`;
				}
				if (result.errors.length > 0) {
					noticeText += `\n错误: ${result.errors.length} 个`;
				}
				
				new Notice(noticeText);

				this.close();
			} catch (error) {
				new Notice(`导入失败: ${error.message}`);
			} finally {
				importBtn.disabled = false;
				importBtn.textContent = '开始导入';
			}
		});

		// 取消按钮
		const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
		cancelBtn.addEventListener('click', () => this.close());

		// 存储引用以便更新
		(this as any).previewEl = previewEl;
		(this as any).importBtn = importBtn;
	}

	/**
	 * 从页面提取图片
	 * 关键改进：先渲染页面以确保所有图片对象都被加载到内存
	 */
	async extractImagesFromPage(page: any, pageNum: number): Promise<PdfImage[]> {
		const images: PdfImage[] = [];
		
		try {
			// 关键步骤：先渲染页面到一个小的 canvas，这会触发所有资源（包括图片）的加载
			// 这是解决"图片对象为空"问题的核心方法
			const viewport = page.getViewport({ scale: 0.1 }); // 使用小比例节省资源
			const canvas = document.createElement('canvas');
			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			const context = canvas.getContext('2d', { willReadFrequently: false });
			
			if (context) {
				// 渲染页面，这会加载所有图片对象
				await page.render({
					canvasContext: context,
					viewport: viewport
				}).promise;
			}
			
			// 现在获取 operatorList，此时图片对象应该已经加载完成
			const operatorList = await page.getOperatorList();
			const operators = operatorList.fnArray;
			const args = operatorList.argsArray;
			
			// 收集所有图片名称
			const imageNames: string[] = [];
			for (let i = 0; i < operators.length; i++) {
				const op = operators[i];
				if (op === PDF_OPS.paintImageXObject || op === PDF_OPS.paintJpegXObject || op === PDF_OPS.paintImageMaskXObject) {
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
					const imgData = await this.getImageDataFromPage(page, imageName);
					if (imgData && (imgData.data || imgData.bitmap)) {
						const imageInfo = await this.convertImageData(imgData);
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

	/**
	 * 从页面对象获取图片数据
	 * 因为已经渲染过页面，图片对象应该都已加载，可以直接同步获取
	 */
	private async getImageDataFromPage(page: any, imageName: string): Promise<any> {
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
	 * 将 pdfjs 图片数据转换为标准格式
	 */
	async convertImageData(imgData: any): Promise<{ data: Uint8Array; format: string; width: number; height: number } | null> {
		try {
			const width = imgData.width;
			const height = imgData.height;
			
			// 如果已经是 JPEG 数据（通过 data URL 或直接的 JPEG 数据）
			if (imgData.data instanceof Uint8Array && this.isJpegData(imgData.data)) {
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
						rgba[j * 4] = data[j * 3];       // R
						rgba[j * 4 + 1] = data[j * 3 + 1]; // G
						rgba[j * 4 + 2] = data[j * 3 + 2]; // B
						rgba[j * 4 + 3] = 255;             // A
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
				canvas.toBlob((blob) => resolve(blob), 'image/png');
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
	 * 检测是否是 JPEG 数据
	 */
	isJpegData(data: Uint8Array): boolean {
		// JPEG 文件以 FFD8FF 开头
		return data.length >= 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF;
	}

	async handleFile(file: File, dropZone: HTMLElement) {
		const importBtn = (this as any).importBtn as HTMLButtonElement;
		const previewEl = (this as any).previewEl as HTMLElement;

		// 显示加载动画和进度条
		dropZone.empty();
		dropZone.addClass('loading');
		const loadingEl = dropZone.createDiv({ cls: 'one-diary-loading' });
		loadingEl.createDiv({ cls: 'one-diary-spinner' });
		const loadingText = loadingEl.createEl('p', { text: '正在读取 PDF 文件...', cls: 'one-diary-loading-text' });
		
		// 进度条容器
		const progressContainer = loadingEl.createDiv({ cls: 'one-diary-progress-container' });
		const progressBar = progressContainer.createDiv({ cls: 'one-diary-progress-bar' });
		const progressFill = progressBar.createDiv({ cls: 'one-diary-progress-fill' });
		const progressText = progressContainer.createDiv({ cls: 'one-diary-progress-text' });

		// 更新进度的辅助函数
		const updateProgress = (current: number, total: number, stage: string) => {
			const percent = Math.round((current / total) * 100);
			progressFill.style.width = `${percent}%`;
			progressText.textContent = `${stage} (${current}/${total})`;
		};

		try {
			// 检查 pdfjs-dist 是否可用
			if (!pdfjsLib) {
				throw new Error('pdfjs-dist 模块未正确加载');
			}

			// 配置 pdfjs-dist worker
			if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
				const workerUrls = [
					`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`,
					`https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`,
					`https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`
				];
				pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrls[0];
			}

			loadingText.textContent = '正在加载 PDF 文档...';

			// 读取 PDF 文件
			const arrayBuffer = await file.arrayBuffer();
			
			const loadingTask = pdfjsLib.getDocument({ 
				data: arrayBuffer,
				verbosity: 0,
				disableAutoFetch: true,
				disableStream: false
			});
			const pdfDocument = await loadingTask.promise;
			
			// 清空之前的数据
			this.pageImages.clear();
			this.pageToDate.clear();
			
			// 提取所有页面的文本和图片
			let pdfText = '';
			const numPages = pdfDocument.numPages;
			const shouldExtractImages = this.plugin.settings.importAttachments;
			
			loadingText.textContent = '正在解析页面...';
			
			// 用于跟踪每个页面的日期
			const dateRegex = /(\d{4})年(\d{2})[月⽉](\d{2})[日⽇]/;
			
			for (let pageNum = 1; pageNum <= numPages; pageNum++) {
				// 更新进度
				updateProgress(pageNum, numPages, '解析页面');
				
				const page = await pdfDocument.getPage(pageNum);
				const textContent = await page.getTextContent();
				
				// 组合文本项
				let pageText = '';
				let lastY: number | null = null;
				
				for (const item of textContent.items) {
					if ('str' in item && item.str) {
						const currentY = (item as any).transform?.[5] || null;
						if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 1) {
							pageText += '\n';
						}
						pageText += item.str;
						lastY = currentY;
					}
				}
				
				if (pageText) {
					pdfText += (pdfText ? '\n\n' : '') + pageText;
					
					// 检测页面中的日期，建立页码到日期的映射
					const dateMatch = pageText.match(dateRegex);
					if (dateMatch) {
						const [, year, month, day] = dateMatch;
						const date = `${year}-${month}-${day}`;
						// 只记录第一次出现的日期
						if (!this.pageToDate.has(pageNum)) {
							this.pageToDate.set(pageNum, date);
						}
					}
				}
				
				// 提取图片
				if (shouldExtractImages) {
					const images = await this.extractImagesFromPage(page, pageNum);
					if (images.length > 0) {
						this.pageImages.set(pageNum, images);
					}
				}
			}
			
			this.pdfText = pdfText;

			loadingText.textContent = '正在解析日记条目...';
			progressFill.style.width = '100%';
			progressText.textContent = '完成';

			const { entries, errors } = parsePdfDiary(pdfText);
			
			// 统计提取的图片数量
			let totalImages = 0;
			this.pageImages.forEach((images) => {
				totalImages += images.length;
			});

			// 解析完成，移除加载状态
			dropZone.removeClass('loading');
			dropZone.empty();
			dropZone.createEl('p', { text: `✓ 已选择: ${file.name}` });
			dropZone.createEl('p', { text: `找到 ${entries.length} 篇日记`, cls: 'one-diary-count' });
			if (shouldExtractImages && totalImages > 0) {
				dropZone.createEl('p', { text: `提取到 ${totalImages} 张图片`, cls: 'one-diary-count' });
			}

			// 显示预览
			if (entries.length > 0) {
				previewEl.style.display = 'block';
				previewEl.empty();
				previewEl.createEl('h4', { text: '预览 (前3篇)' });
				
				const previewList = previewEl.createEl('ul');
				const addTitle = this.plugin.settings.addTitle;
				
				entries.slice(0, 3).forEach(entry => {
					const li = previewList.createEl('li');
					li.createEl('strong', { text: entry.date });
					
					if (addTitle) {
						li.createSpan({ text: ` - ${entry.weekday}` });
						if (entry.time) {
							li.createSpan({ text: ` · ${entry.time}` });
						}
						if (entry.weather) {
							li.createSpan({ text: ` · ${entry.weather}` });
						}
						if (entry.temperature) {
							li.createSpan({ text: ` · ${entry.temperature}` });
						}
						if (entry.location) {
							li.createSpan({ text: ` · ${entry.location}` });
						}
					}
					
					li.createEl('br');
					li.createSpan({ 
						text: entry.content.substring(0, 50) + (entry.content.length > 50 ? '...' : ''),
						cls: 'one-diary-preview-content'
					});
				});

				importBtn.disabled = false;
			}
		} catch (error) {
			const errorMessage = error instanceof Error 
				? `${error.message}\n堆栈: ${error.stack?.substring(0, 200)}` 
				: String(error);
			
			console.error('PDF 导入错误:', error);
			new Notice(`读取 PDF 文件失败: ${errorMessage}`);
			
			dropZone.removeClass('loading');
			dropZone.empty();
			dropZone.createEl('p', { text: `❌ 错误: ${file.name}`, cls: 'one-diary-error' });
			dropZone.createEl('p', { text: errorMessage, cls: 'one-diary-error-detail' });
			dropZone.createEl('p', { 
				text: '提示: 请检查控制台 (Ctrl/Cmd + Shift + I) 查看详细错误信息', 
				cls: 'one-diary-error-hint' 
			});
		}
	}

	/**
	 * 将图片与日记条目关联
	 * 基于页码和日期的映射关系
	 */
	associateImagesWithEntries(entries: DiaryEntry[]): DiaryEntry[] {
		// 创建日期到条目的映射
		const dateToEntry = new Map<string, DiaryEntry>();
		for (const entry of entries) {
			dateToEntry.set(entry.date, entry);
		}
		
		// 遍历页面图片，将图片关联到对应日期的日记
		this.pageImages.forEach((images, pageNum) => {
			const date = this.pageToDate.get(pageNum);
			if (date) {
				const entry = dateToEntry.get(date);
				if (entry) {
					if (!entry.attachments) {
						entry.attachments = [];
					}
					// 为每张图片生成一个临时标识符
					images.forEach((img, idx) => {
						const imageName = `diary-${date}-p${pageNum}-${idx}.${img.format}`;
						entry.attachments!.push(imageName);
					});
				}
			}
		});
		
		return entries;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.pdfText = null;
		this.pageImages.clear();
		this.pageToDate.clear();
	}
}

