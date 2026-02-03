import { App, Modal, Notice } from 'obsidian';
import type OneDiaryPlugin from '../plugin';
import { parseTxtDiary } from '../parser';

/**
 * 导入对话框（TXT）
 */
export class ImportModal extends Modal {
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

				entries.slice(0, 3).forEach((entry) => {
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
			new Notice(`读取文件失败: ${(error as Error).message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.fileContent = null;
	}
}
