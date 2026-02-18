/**
 * 1Diary 日记条目接口
 */
export interface DiaryEntry {
	/** 日期 - 格式: YYYY-MM-DD */
	date: string;
	/** 星期 */
	weekday: string;
	/** 时间 - 格式: HH:mm (从 PDF 中提取) */
	time?: string;
	/** 天气 */
	weather?: string;
	/** 温度 */
	temperature?: string;
	/** 位置 */
	location?: string;
	/** 日记内容 */
	content: string;
	/** 附件图片列表 */
	attachments?: string[];
	/** 标签 */
	tags?: string[];
	/** 分类 */
	category?: string;
}

/**
 * 插件设置接口
 */
export interface OneDiarySettings {
	/** 日记输出目录 */
	outputFolder: string;
	/** 日期格式 - 用于文件名 */
	dateFormat: string;
	/** 是否按年份创建子文件夹 */
	groupByYear: boolean;
	/** 是否导入图片附件 */
	importAttachments: boolean;
	/** 图片附件目录 */
	attachmentFolder: string;
	/** 是否添加一级 markdown 标题 */
	addTitle: boolean;
	/** 上次导入时间戳 */
	lastImportTime?: number;
}

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: OneDiarySettings = {
	outputFolder: '日记',
	dateFormat: 'YYYY-MM-DD',
	groupByYear: true,
	importAttachments: true,
	attachmentFolder: 'attachments/diary',
	addTitle: true,
};

/**
 * PDF 图片数据接口
 */
export interface PdfImage {
	/** 图片数据（Base64 或 Uint8Array） */
	data: Uint8Array;
	/** 图片格式：png, jpeg 等 */
	format: string;
	/** 图片宽度 */
	width: number;
	/** 图片高度 */
	height: number;
	/** 图片所在页码 */
	pageNum: number;
	/** 图片在页面中的索引 */
	imageIndex: number;
}

/**
 * PDF 解析结果（包含图片）
 */
export interface PdfParseResult {
	entries: DiaryEntry[];
	errors: string[];
	/** 图片数据（按页码分组） */
	images: Map<number, PdfImage[]>;
}

/**
 * 解析结果
 */
export interface ParseResult {
	entries: DiaryEntry[];
	errors: string[];
	/** PDF 解析时每条目在全文中的起止行（仅 parsePdfDiary 填充） */
	entryLineRanges?: { startLine: number; endLine: number }[];
}

