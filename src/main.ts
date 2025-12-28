import { App, Modal, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { OneDiarySettings, DEFAULT_SETTINGS, DiaryEntry } from './types';
import { parseTxtDiary, diaryToMarkdown, generateFileName } from './parser';
import { OneDiarySettingTab } from './settings';

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

		try {
			this.fileContent = await file.text();
			const { entries } = parseTxtDiary(this.fileContent);

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
			new Notice(`读取文件失败: ${error.message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.fileContent = null;
	}
}

