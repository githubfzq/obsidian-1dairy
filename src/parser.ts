import { DiaryEntry, ParseResult } from './types';

/**
 * TXT 格式日记解析器
 * 解析 1Diary 导出的纯文本格式
 * 
 * 格式示例:
 * 2025年02月08日 周六 · 晴 · 4℃ · 斜塘淞泽家园六区
 * 日记内容...
 * 
 * 2025年02月10日 周一 · 晴 · 4℃ · 斜塘淞泽家园六区
 * 日记内容...
 */

// 日期行正则表达式
// 匹配: 2025年02月08日 周六 · 晴 · 4℃ · 斜塘淞泽家园六区
const DATE_LINE_REGEX = /^(\d{4})年(\d{2})月(\d{2})日\s+(周[一二三四五六日])\s*·?\s*([^·]*?)?\s*·?\s*(-?\d+℃)?\s*·?\s*(.+)?$/;

/**
 * 解析 TXT 格式的日记文件
 */
export function parseTxtDiary(content: string): ParseResult {
	const entries: DiaryEntry[] = [];
	const errors: string[] = [];
	
	// 按行分割
	const lines = content.split('\n');
	
	let currentEntry: DiaryEntry | null = null;
	let contentLines: string[] = [];
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const match = line.match(DATE_LINE_REGEX);
		
		if (match) {
			// 保存前一条日记
			if (currentEntry) {
				currentEntry.content = contentLines.join('\n').trim();
				if (currentEntry.content) {
					entries.push(currentEntry);
				}
			}
			
			// 解析新日记的元数据
			const [, year, month, day, weekday, weather, temperature, location] = match;
			
			currentEntry = {
				date: `${year}-${month}-${day}`,
				weekday: weekday,
				weather: weather?.trim() || undefined,
				temperature: temperature?.replace('℃', '°C') || undefined,
				location: location?.trim() || undefined,
				content: '',
			};
			contentLines = [];
		} else if (currentEntry) {
			// 累积内容行
			contentLines.push(line);
		}
	}
	
	// 保存最后一条日记
	if (currentEntry) {
		currentEntry.content = contentLines.join('\n').trim();
		if (currentEntry.content) {
			entries.push(currentEntry);
		}
	}
	
	return { entries, errors };
}

/**
 * 将日记条目转换为 Markdown 格式
 * @param entry 日记条目
 * @param addTitle 是否添加一级 markdown 标题，默认为 true
 */
export function diaryToMarkdown(entry: DiaryEntry, addTitle: boolean = true): string {
	const lines: string[] = [];
	
	// YAML frontmatter
	lines.push('---');
	lines.push(`date: ${entry.date}`);
	lines.push(`weekday: ${entry.weekday}`);
	if (entry.weather) {
		lines.push(`weather: ${entry.weather}`);
	}
	if (entry.temperature) {
		lines.push(`temperature: ${entry.temperature}`);
	}
	if (entry.location) {
		lines.push(`location: "${entry.location}"`);
	}
	if (entry.tags && entry.tags.length > 0) {
		lines.push(`tags: [${entry.tags.join(', ')}]`);
	}
	if (entry.category) {
		lines.push(`category: ${entry.category}`);
	}
	lines.push('---');
	lines.push('');
	
	// 标题 - 使用日期和天气信息（根据设置决定是否添加）
	if (addTitle) {
		const titleParts = [entry.weekday];
		if (entry.weather) titleParts.push(entry.weather);
		if (entry.temperature) titleParts.push(entry.temperature);
		if (entry.location) titleParts.push(entry.location);
		
		lines.push(`# ${titleParts.join(' · ')}`);
		lines.push('');
	}
	
	// 正文内容
	lines.push(entry.content);
	
	// 附件图片
	if (entry.attachments && entry.attachments.length > 0) {
		lines.push('');
		lines.push('## 附件');
		for (const attachment of entry.attachments) {
			lines.push(`![[${attachment}]]`);
		}
	}
	
	return lines.join('\n');
}

/**
 * 生成日记文件名
 */
export function generateFileName(entry: DiaryEntry, format: string): string {
	// 简单的日期格式替换
	let fileName = format
		.replace('YYYY', entry.date.substring(0, 4))
		.replace('MM', entry.date.substring(5, 7))
		.replace('DD', entry.date.substring(8, 10));
	
	return `${fileName}.md`;
}

