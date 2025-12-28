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
 * 解析结果
 */
export interface ParseResult {
	entries: DiaryEntry[];
	errors: string[];
}

