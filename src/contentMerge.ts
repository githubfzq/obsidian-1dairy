import type { DiaryEntry } from './types';

/**
 * 解析现有 Markdown 文件，提取 frontmatter 和 body
 */
export function parseMarkdownFile(content: string): { frontmatter: string; body: string } {
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
export function mergeDiaryContent(existingContent: string, newEntry: DiaryEntry): string {
	const { frontmatter, body } = parseMarkdownFile(existingContent);

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
 * 合并日记内容（包含附件）
 */
export function mergeDiaryContentWithAttachments(existingContent: string, newEntry: DiaryEntry): string {
	const { frontmatter, body } = parseMarkdownFile(existingContent);

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
