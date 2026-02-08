import { Plugin, TFile } from 'obsidian';
import { OneDiarySettings, DEFAULT_SETTINGS, DiaryEntry, PdfImage } from './types';
import { diaryToMarkdown, generateFileName } from './parser';
import { OneDiarySettingTab } from './settings';
import { mergeDiaryContent, mergeDiaryContentWithAttachments } from './contentMerge';

export default class OneDiaryPlugin extends Plugin {
	settings: OneDiarySettings;

	async onload() {
		await this.loadSettings();

		// 添加导入命令（动态加载 Modal 避免循环依赖）
		this.addCommand({
			id: 'import-txt-diary',
			name: '导入 TXT 格式日记',
			callback: () => {
				import('./modals/ImportTxtModal').then((m) => new m.ImportModal(this.app, this).open());
			}
		});

		this.addCommand({
			id: 'import-pdf-diary',
			name: '导入 PDF 格式日记',
			callback: () => {
				import('./modals/ImportPdfModal').then((m) => new m.ImportPdfModal(this.app, this).open());
			}
		});

		// 添加设置选项卡
		this.addSettingTab(new OneDiarySettingTab(this.app, this));

		// 添加 Ribbon 图标
		this.addRibbonIcon('book-open', '导入 1Diary 日记', () => {
			import('./modals/ImportTxtModal').then((m) => new m.ImportModal(this.app, this).open());
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
	 * 导入日记条目到 Obsidian
	 */
	async importEntries(
		entries: DiaryEntry[],
		groupByYear?: boolean
	): Promise<{ success: number; skipped: number; errors: string[] }> {
		const result = { success: 0, skipped: 0, errors: [] as string[] };
		const vault = this.app.vault;

		const shouldGroupByYear = groupByYear !== undefined ? groupByYear : this.settings.groupByYear;

		await this.ensureFolder(this.settings.outputFolder);

		for (const entry of entries) {
			try {
				let folderPath = this.settings.outputFolder;
				if (shouldGroupByYear) {
					const year = entry.date.substring(0, 4);
					folderPath = `${this.settings.outputFolder}/${year}`;
					await this.ensureFolder(folderPath);
				}

				const fileName = generateFileName(entry, this.settings.dateFormat);
				const filePath = `${folderPath}/${fileName}`;

				const existingFile = vault.getAbstractFileByPath(filePath);
				if (existingFile && existingFile instanceof TFile) {
					const existingContent = await vault.read(existingFile);
					const mergedContent = mergeDiaryContent(existingContent, entry);
					await vault.modify(existingFile, mergedContent);
					result.success++;
				} else {
					const markdown = diaryToMarkdown(entry, this.settings.addTitle);
					await vault.create(filePath, markdown);
					result.success++;
				}
			} catch (error) {
				result.errors.push(`${entry.date}: ${(error as Error).message}`);
			}
		}

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
	 * @param pageNumToResolvedDate 可选：每页解析后的日期（与 associate 逻辑一致），用于在 pageToDate 为空时仍能保存图片
	 */
	async importEntriesWithImages(
		entries: DiaryEntry[],
		pageImages: Map<number, PdfImage[]>,
		pageToDate: Map<number, string>,
		pageNumToResolvedDate?: Map<number, string>
	): Promise<{ success: number; skipped: number; errors: string[]; imagesImported: number }> {
		const result = { success: 0, skipped: 0, errors: [] as string[], imagesImported: 0 };
		const vault = this.app.vault;

		await this.ensureFolder(this.settings.outputFolder);

		if (this.settings.importAttachments) {
			await this.ensureFolder(this.settings.attachmentFolder);
		}

		if (this.settings.importAttachments && pageImages.size > 0) {
			for (const [pageNum, images] of pageImages) {
				const date = pageNumToResolvedDate?.get(pageNum) ?? pageToDate.get(pageNum);
				if (!date) continue;

				for (let idx = 0; idx < images.length; idx++) {
					const img = images[idx];
					const imageName = `diary-${date}-p${pageNum}-${idx}.${img.format}`;
					const imagePath = `${this.settings.attachmentFolder}/${imageName}`;

					try {
						const existingFile = vault.getAbstractFileByPath(imagePath);
						if (!existingFile) {
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

		for (const entry of entries) {
			try {
				let folderPath = this.settings.outputFolder;
				if (this.settings.groupByYear) {
					const year = entry.date.substring(0, 4);
					folderPath = `${this.settings.outputFolder}/${year}`;
					await this.ensureFolder(folderPath);
				}

				const fileName = generateFileName(entry, this.settings.dateFormat);
				const filePath = `${folderPath}/${fileName}`;

				const existingFile = vault.getAbstractFileByPath(filePath);
				if (existingFile && existingFile instanceof TFile) {
					const existingContent = await vault.read(existingFile);
					const mergedContent = mergeDiaryContentWithAttachments(existingContent, entry);
					await vault.modify(existingFile, mergedContent);
					result.success++;
				} else {
					const markdown = diaryToMarkdown(entry, this.settings.addTitle);
					await vault.create(filePath, markdown);
					result.success++;
				}
			} catch (error) {
				result.errors.push(`${entry.date}: ${(error as Error).message}`);
			}
		}

		this.settings.lastImportTime = Date.now();
		await this.saveSettings();

		return result;
	}
}
