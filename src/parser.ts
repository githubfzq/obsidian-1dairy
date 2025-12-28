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
 * 清理PDF提取时可能出现的重复字符
 * 例如: "2025202520252025年02020202⽉08080808⽇" -> "2025年02月08日"
 * 注意：支持各种Unicode变体的"月"和"日"字符
 */
function cleanRepeatedChars(text: string): string {
	// 只处理包含"年"、"月"、"日"的日期行（支持各种Unicode变体）
	if (!/年|月|日|⽉|⽇/.test(text)) {
		return text;
	}
	
	// 匹配日期格式：YYYY年MM月DD日（可能包含重复字符和Unicode变体）
	// 例如: "2025202520252025年02020202⽉08080808⽇"
	// 支持: 月/⽉, 日/⽇ 等Unicode变体
	const datePattern = /(\d+)年(\d+)[月⽉](\d+)[日⽇]/;
	const match = text.match(datePattern);
	
	if (match) {
		const [, yearPart, monthPart, dayPart] = match;
		
		// 清理年份：提取前4位数字（去除重复）
		let cleanYear = yearPart;
		if (yearPart.length > 4) {
			// 如果年份部分过长，尝试提取重复模式
			// 例如: "2025202520252025" -> 检测到"2025"重复4次 -> "2025"
			const yearMatch = yearPart.match(/^(\d{4})(\1)+$/);
			if (yearMatch) {
				cleanYear = yearMatch[1];
			} else {
				// 否则只取前4位
				cleanYear = yearPart.substring(0, 4);
			}
		}
		
		// 清理月份：提取前2位数字
		let cleanMonth = monthPart;
		if (monthPart.length > 2) {
			const monthMatch = monthPart.match(/^(\d{2})(\1)+$/);
			if (monthMatch) {
				cleanMonth = monthMatch[1];
			} else {
				cleanMonth = monthPart.substring(0, 2);
			}
		}
		
		// 清理日期：提取前2位数字
		let cleanDay = dayPart;
		if (dayPart.length > 2) {
			const dayMatch = dayPart.match(/^(\d{2})(\1)+$/);
			if (dayMatch) {
				cleanDay = dayMatch[1];
			} else {
				cleanDay = dayPart.substring(0, 2);
			}
		}
		
		// 替换原文本中的日期部分，统一使用标准字符
		const cleaned = text.replace(datePattern, `${cleanYear}年${cleanMonth}月${cleanDay}日`);
		
		// 如果清理后的文本只包含日期（去除前后空白），直接返回清理后的日期
		const trimmed = cleaned.trim();
		if (/^\d{4}年\d{2}月\d{2}日\s*$/.test(trimmed)) {
			return trimmed;
		}
		
		return cleaned;
	}
	
	return text;
}

// PDF 格式日期标题行正则表达式
// 匹配: # 2025年02月08日 或 2025年02月08日 (无#号)
// 也支持清理后的格式: 2025202520252025年02020202⽉08080808⽇
const PDF_DATE_HEADER_REGEX = /^#?\s*(\d{4})年(\d{2})月(\d{2})日\s*$/;

// PDF 格式日期行正则表达式（用于直接匹配日期行，不要求#号）
// 匹配: 2025年02月08日 或清理后的重复格式
const PDF_DATE_LINE_REGEX = /^(\d{4})年(\d{2})月(\d{2})日\s*$/;

// PDF 格式元数据行正则表达式
// 匹配: 周六·21:55·晴·4°C·斜塘淞泽家园六区 (无空格)
// 或: 周六 · 21:55 · 晴 · 4℃ · 斜塘淞泽家园六区 (有空格，使用℃)
// 或: 周三 · 23:59 · 雨 · 斜塘淞泽家园六区 (无温度)
// 格式: weekday[空格]·[空格]time[空格]·[空格]weather[空格]·[空格](temperature[空格]·[空格])?location
// 注意：温度是可选的，但位置是必需的
const PDF_METADATA_LINE_REGEX = /^([周一二三四五六日]+)\s*·\s*(\d{2}:\d{2})\s*·\s*([^·]*?)\s*·\s*(?:(?:(-?\d+[°℃]C?)\s*·\s*)?(.+))$/;

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
 * PDF 格式日记解析器
 * 解析 1Diary 导出的 PDF 格式
 * 
 * 格式示例:
 * # 2025年02月08日
 * 周六·21:55·晴·4°C·斜塘淞泽家园六区
 * 日记内容...
 * 
 * # 2025年02月10日
 * 周一·21:48·晴·4°C·斜塘淞泽家园六区
 * 日记内容...
 */
export function parsePdfDiary(content: string): ParseResult {
	const entries: DiaryEntry[] = [];
	const errors: string[] = [];
	
	// 按行分割
	const lines = content.split('\n');
	
	let currentEntry: DiaryEntry | null = null;
	let contentLines: string[] = [];
	let expectingMetadata = false; // 标记是否在等待元数据行
	let dateHeaderCount = 0; // 统计匹配到的日期标题行
	let metadataCount = 0; // 统计匹配到的元数据行
	
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		
		// 先清理可能的重复字符（特别是日期行）
		const cleanedLine = cleanRepeatedChars(line);
		if (cleanedLine !== line) {
			line = cleanedLine;
		}
		
		// 检查是否是日期标题行（支持#号或没有#号）
		// 先尝试匹配原始行
		let dateMatch = line.match(PDF_DATE_HEADER_REGEX);
		// 如果没有匹配到，尝试使用更宽松的日期行正则（无#号）
		if (!dateMatch) {
			dateMatch = line.match(PDF_DATE_LINE_REGEX);
		}
		// 如果还是没匹配到，尝试trim后的行
		if (!dateMatch) {
			const trimmedLine = line.trim();
			dateMatch = trimmedLine.match(PDF_DATE_HEADER_REGEX);
			if (!dateMatch) {
				dateMatch = trimmedLine.match(PDF_DATE_LINE_REGEX);
			}
			if (dateMatch) {
				line = trimmedLine; // 使用trim后的行
			}
		}
		// 如果还是没匹配到，尝试更宽松的匹配（允许前后有空格或其他字符）
		if (!dateMatch && /年.*[月⽉].*[日⽇]/.test(line)) {
			// 尝试更宽松的匹配：只提取数字部分，支持Unicode变体
			const looseMatch = line.match(/(\d{4})年(\d{2})[月⽉](\d{2})[日⽇]/);
			if (looseMatch) {
				dateMatch = looseMatch;
			}
		}
		if (dateMatch) {
			dateHeaderCount++;
			
			// 保存前一条日记
			if (currentEntry) {
				currentEntry.content = contentLines.join('\n').trim();
				if (currentEntry.content) {
					entries.push(currentEntry);
				}
			}
			
			// 解析新日记的日期
			const [, year, month, day] = dateMatch;
			
			currentEntry = {
				date: `${year}-${month}-${day}`,
				weekday: '',
				content: '',
			};
			contentLines = [];
			expectingMetadata = true;
			continue;
		}
		
		// 如果正在等待元数据行，检查是否是元数据行
		if (expectingMetadata && currentEntry) {
			const metadataMatch = line.match(PDF_METADATA_LINE_REGEX);
			if (metadataMatch) {
				metadataCount++;
				const [, weekday, time, weather, temperature, location] = metadataMatch;
				
				currentEntry.weekday = weekday;
				currentEntry.time = time || undefined;
				currentEntry.weather = weather?.trim() || undefined;
				// 统一温度格式：将℃转换为°C
				currentEntry.temperature = temperature?.replace(/℃/g, '°C').replace(/°C/g, '°C') || undefined;
				currentEntry.location = location?.trim() || undefined;
				
				expectingMetadata = false;
				continue;
			} else {
				// 如果下一行不是元数据，可能是空行或格式异常
				// 继续处理，但记录警告
				if (line.trim()) {
					const errorMsg = `日期 ${currentEntry.date} 后未找到元数据行，跳过元数据解析。实际行内容: ${JSON.stringify(line)}`;
					errors.push(errorMsg);
				}
				expectingMetadata = false;
			}
		}
		
		// 累积内容行
		if (currentEntry && !expectingMetadata) {
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
	if (entry.time) {
		lines.push(`time: ${entry.time}`);
	}
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
		if (entry.time) titleParts.push(entry.time);
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

