import { App, PluginSettingTab, Setting } from 'obsidian';
import type OneDiaryPlugin from './main';

export class OneDiarySettingTab extends PluginSettingTab {
	plugin: OneDiaryPlugin;

	constructor(app: App, plugin: OneDiaryPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: '1Diary 导入设置' });

		// 输出目录设置
		new Setting(containerEl)
			.setName('日记输出目录')
			.setDesc('导入的日记将保存到此目录')
			.addText(text => text
				.setPlaceholder('日记')
				.setValue(this.plugin.settings.outputFolder)
				.onChange(async (value) => {
					this.plugin.settings.outputFolder = value || '日记';
					await this.plugin.saveSettings();
				}));

		// 日期格式设置
		new Setting(containerEl)
			.setName('文件名日期格式')
			.setDesc('用于生成日记文件名的日期格式（YYYY=年, MM=月, DD=日）')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value || 'YYYY-MM-DD';
					await this.plugin.saveSettings();
				}));

		// 按年份分组
		new Setting(containerEl)
			.setName('按年份分组')
			.setDesc('是否按年份创建子文件夹（如: 日记/2025/）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.groupByYear)
				.onChange(async (value) => {
					this.plugin.settings.groupByYear = value;
					await this.plugin.saveSettings();
				}));

		// 添加标题选项
		new Setting(containerEl)
			.setName('添加标题')
			.setDesc('导出时是否在 markdown 笔记中添加一级标题（格式：周X · 天气 · 温度 · 位置）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.addTitle)
				.onChange(async (value) => {
					this.plugin.settings.addTitle = value;
					await this.plugin.saveSettings();
				}));

		// 附件设置
		containerEl.createEl('h3', { text: '附件设置' });

		new Setting(containerEl)
			.setName('导入图片附件')
			.setDesc('是否导入日记中的图片附件')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.importAttachments)
				.onChange(async (value) => {
					this.plugin.settings.importAttachments = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('附件保存目录')
			.setDesc('图片附件将保存到此目录')
			.addText(text => text
				.setPlaceholder('attachments/diary')
				.setValue(this.plugin.settings.attachmentFolder)
				.onChange(async (value) => {
					this.plugin.settings.attachmentFolder = value || 'attachments/diary';
					await this.plugin.saveSettings();
				}));

		// 导入状态
		if (this.plugin.settings.lastImportTime) {
			const lastImport = new Date(this.plugin.settings.lastImportTime);
			containerEl.createEl('p', {
				text: `上次导入时间: ${lastImport.toLocaleString()}`,
				cls: 'setting-item-description'
			});
		}
	}
}

