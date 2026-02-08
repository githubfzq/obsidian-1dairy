import { App, Modal, Notice } from 'obsidian';
import type OneDiaryPlugin from '../plugin';
import type { DiaryEntry, PdfImage } from '../types';
import { parsePdfDiary } from '../parser';
import { extractImagesFromPage } from '../pdfExtractor';
// @ts-ignore - pdfjs-dist types may not be perfect
import * as pdfjsLib from 'pdfjs-dist';

/**
 * PDF 导入对话框
 */
export class ImportPdfModal extends Modal {
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
				const pageNumToResolvedDate = this.getResolvedPageToDate(entries);

				// 导入日记和图片
				const result = await this.plugin.importEntriesWithImages(
					entriesWithImages,
					this.pageImages,
					this.pageToDate,
					pageNumToResolvedDate
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
				new Notice(`导入失败: ${(error as Error).message}`);
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

		// 显示加载动画和进度条
		dropZone.empty();
		dropZone.addClass('loading');
		const loadingEl = dropZone.createDiv({ cls: 'one-diary-loading' });
		loadingEl.createDiv({ cls: 'one-diary-spinner' });
		const loadingText = loadingEl.createEl('p', {
			text: '正在读取 PDF 文件...',
			cls: 'one-diary-loading-text'
		});

		// 进度条容器
		const progressContainer = loadingEl.createDiv({ cls: 'one-diary-progress-container' });
		const progressBar = progressContainer.createDiv({ cls: 'one-diary-progress-bar' });
		const progressFill = progressBar.createDiv({ cls: 'one-diary-progress-fill' });
		const progressText = progressContainer.createDiv({ cls: 'one-diary-progress-text' });

		const updateProgress = (current: number, total: number, stage: string) => {
			const percent = Math.round((current / total) * 100);
			progressFill.style.width = `${percent}%`;
			progressText.textContent = `${stage} (${current}/${total})`;
		};

		try {
			if (!pdfjsLib) {
				throw new Error('pdfjs-dist 模块未正确加载');
			}

			if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
				const workerUrls = [
					`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`,
					`https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`,
					`https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`
				];
				pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrls[0];
			}

			loadingText.textContent = '正在加载 PDF 文档...';

			const arrayBuffer = await file.arrayBuffer();

			const loadingTask = pdfjsLib.getDocument({
				data: arrayBuffer,
				verbosity: 0,
				disableAutoFetch: true,
				disableStream: false
			});
			const pdfDocument = await loadingTask.promise;

			this.pageImages.clear();
			this.pageToDate.clear();

			let pdfText = '';
			const numPages = pdfDocument.numPages;
			const shouldExtractImages = this.plugin.settings.importAttachments;

			loadingText.textContent = '正在解析页面...';

			const dateRegex = /(\d{4})年(\d{2})[月⽉](\d{2})[日⽇]/;

			for (let pageNum = 1; pageNum <= numPages; pageNum++) {
				updateProgress(pageNum, numPages, '解析页面');

				const page = await pdfDocument.getPage(pageNum);
				const textContent = await page.getTextContent();

				// 按行合并：PDF.js 的 items 是小块（字/词级别），需按 y 分组、行内按 x 排序后再拼接
				type TextItemWithPos = { str: string; x: number; y: number };
				const itemsWithPos: TextItemWithPos[] = [];
				for (const item of textContent.items) {
					if ('str' in item && item.str) {
						const transform = (item as { str: string; transform?: number[] }).transform;
						const x = transform?.[4] ?? 0;
						const y = transform?.[5] ?? 0;
						itemsWithPos.push({ str: item.str, x, y });
					}
				}

				const lineTolerance = 2; // 同一行 y 可能略有浮动
				const lineMap = new Map<number, TextItemWithPos[]>();
				for (const it of itemsWithPos) {
					const yKey = Math.round(it.y / lineTolerance) * lineTolerance;
					if (!lineMap.has(yKey)) lineMap.set(yKey, []);
					lineMap.get(yKey)!.push(it);
				}

				const lines: string[] = [];
				const sortedYKeys = [...lineMap.keys()].sort((a, b) => b - a); // PDF 坐标系从上到下 y 递减
				for (const yKey of sortedYKeys) {
					const lineItems = lineMap.get(yKey)!;
					lineItems.sort((a, b) => a.x - b.x);
					lines.push(lineItems.map((it) => it.str).join(''));
				}
				const pageText = lines.join('\n');

				if (pageText) {
					pdfText += (pdfText ? '\n\n' : '') + pageText;

					const dateMatch = pageText.match(dateRegex);
					if (dateMatch) {
						const [, year, month, day] = dateMatch;
						const date = `${year}-${month}-${day}`;
						if (!this.pageToDate.has(pageNum)) {
							this.pageToDate.set(pageNum, date);
						}
					}
				}

				// 提取图片（使用 pdfExtractor）
				if (shouldExtractImages) {
					const images = await extractImagesFromPage(page, pageNum);
					if (images.length > 0) {
						this.pageImages.set(pageNum, images);
					}
				}
			}

			this.pdfText = pdfText;

			loadingText.textContent = '正在解析日记条目...';
			progressFill.style.width = '100%';
			progressText.textContent = '完成';

			const { entries } = parsePdfDiary(pdfText);

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
				dropZone.createEl('p', {
					text: `提取到 ${totalImages} 张图片`,
					cls: 'one-diary-count'
				});
			}

			// 显示预览
			if (entries.length > 0) {
				previewEl.style.display = 'block';
				previewEl.empty();
				previewEl.createEl('h4', { text: '预览 (前3篇)' });

				const previewList = previewEl.createEl('ul');
				const addTitle = this.plugin.settings.addTitle;

				entries.slice(0, 3).forEach((entry) => {
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
			const errorMessage =
				error instanceof Error
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
	 * 获取页码对应的日期：先查 pageToDate，若无则用前一页的日期（有图无日期页归入前一日期）
	 */
	private getDateForPage(pageNum: number): string | undefined {
		let p = pageNum;
		while (p >= 1) {
			const date = this.pageToDate.get(p);
			if (date) return date;
			p--;
		}
		return undefined;
	}

	/**
	 * 返回每页解析后的日期（与 associate 逻辑一致），供插件保存图片时使用
	 */
	getResolvedPageToDate(entries: DiaryEntry[]): Map<number, string> {
		const resolved = new Map<number, string>();
		const sortedEntryDates = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => e.date);
		const sortedImagePages = [...this.pageImages.keys()].sort((a, b) => a - b);

		this.pageImages.forEach((_, pageNum) => {
			let date = this.getDateForPage(pageNum);
			if (!date && sortedEntryDates.length > 0) {
				const idx = sortedImagePages.indexOf(pageNum);
				date = sortedEntryDates[idx % sortedEntryDates.length];
			}
			if (date) resolved.set(pageNum, date);
		});
		return resolved;
	}

	/**
	 * 将图片与日记条目关联
	 */
	associateImagesWithEntries(entries: DiaryEntry[]): DiaryEntry[] {
		const dateToEntry = new Map<string, DiaryEntry>();
		for (const entry of entries) {
			dateToEntry.set(entry.date, entry);
		}

		const attachmentFolder = this.plugin.settings.attachmentFolder;
		const sortedEntryDates = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => e.date);
		const sortedImagePages = [...this.pageImages.keys()].sort((a, b) => a - b);

		this.pageImages.forEach((images, pageNum) => {
			let date = this.getDateForPage(pageNum);
			if (!date && sortedEntryDates.length > 0) {
				const idx = sortedImagePages.indexOf(pageNum);
				date = sortedEntryDates[idx % sortedEntryDates.length];
			}
			if (date) {
				const entry = dateToEntry.get(date);
				if (entry) {
					if (!entry.attachments) {
						entry.attachments = [];
					}
					images.forEach((img, idx) => {
						const imageName = `diary-${date}-p${pageNum}-${idx}.${img.format}`;
						entry.attachments!.push(`${attachmentFolder}/${imageName}`);
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
