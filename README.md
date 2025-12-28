# Obsidian 1Diary

将「一本日记」(1Diary) App 的日记数据导入到 Obsidian。

## 功能特性

- ✅ 支持 TXT 格式日记导入
- ✅ 自动解析日期、天气、位置等元数据
- ✅ 生成 YAML frontmatter
- ✅ 按年份自动分组
- ✅ 跳过已存在的日记（避免重复导入）
- ✅ 可自定义输出目录和文件名格式

## 安装

### 手动安装

1. 下载最新的 `main.js`, `manifest.json`, `styles.css`
2. 在 Obsidian Vault 目录下创建 `.obsidian/plugins/obsidian-1dairy/` 文件夹
3. 将下载的文件复制到该文件夹
4. 重启 Obsidian，在设置中启用插件

### 开发安装

```bash
# 克隆项目
git clone https://github.com/githubfzq/obsidian-1dairy.git

# 进入目录
cd obsidian-1dairy

# 安装依赖
pnpm install

# 构建
pnpm run build

# 或开发模式（自动监听变化）
pnpm run dev
```

## 使用方法

### 1. 从「一本日记」导出数据

1. 打开「一本日记」App
2. 进入 设置 → 导入导出
3. 选择导出为 **TXT 格式**

### 2. 在 Obsidian 中导入

**方式一：使用命令**
1. 按 `Ctrl/Cmd + P` 打开命令面板
2. 搜索「导入 TXT 格式日记」
3. 选择导出的 TXT 文件
4. 点击「开始导入」

**方式二：点击图标**
- 点击左侧边栏的📖图标，打开导入对话框

## 设置选项

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 日记输出目录 | 导入的日记保存位置 | `日记` |
| 文件名日期格式 | 日记文件名格式 | `YYYY-MM-DD` |
| 按年份分组 | 是否按年份创建子文件夹 | 开启 |
| 导入图片附件 | 是否导入附件（开发中） | 开启 |
| 附件保存目录 | 图片附件保存位置 | `attachments/diary` |

## 导出格式说明

插件支持的 TXT 格式示例：

```
2025年02月08日 周六 · 晴 · 4℃ · 苏州市
今天是美好的一天...

2025年02月09日 周日 · 多云 · 6℃ · 苏州市
另一篇日记内容...
```

导入后生成的 Markdown：

```markdown
---
date: 2025-02-08
weekday: 周六
weather: 晴
temperature: 4°C
location: "苏州市"
---

# 周六 · 晴 · 4°C · 苏州市

今天是美好的一天...
```

## 开发计划

- [ ] 支持 ZIP 压缩包导入
- [ ] 支持图片附件导入
- [ ] 支持标签和分类
- [ ] 增量同步功能
- [ ] 支持 JSON 格式（如果能解密）

## 许可证

MIT License
