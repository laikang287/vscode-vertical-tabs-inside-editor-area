---
date created: 2026-07-22 22:18
author: null
tags: null
source: null
---

# 编辑器区域垂直标签页

- 在vscode的<mark>编辑器区域的左侧</mark>(不是左侧边栏)显示的<mark>垂直标签页</mark>
- 在vscode的界面显示为 `  左侧边栏 | 垂直标签页 | 编辑器区域 | 右侧边栏 `，比vscode的默认样式多出一栏`垂直标签栏`视图

## 展示图

#todo 后续补充

## 本插件解决的痛点

- 官方的标签栏是横向的，显示在顶部，标签一多就特别乱
- 其它插件的垂直标签栏都是在侧边栏显示，由于你会频繁在侧边栏切换功能（如切换到文件列表、搜索等），导致侧边栏的垂直标签栏无法固定显示

## 适合人群

- 用户会经常同时打开非常多个标签页，且屏幕宽度足够

## 功能说明

- **在编辑器区域左侧显示垂直标签页**
- 支持多种语言(i18n)
- 支持标签页组，有包括自动分组手动分组（按类型分组、按父目录分组、跟随vscode横向标签栏）
- 支持标签排序
- 可打开、关闭垂直标签页
- 支持标签页基础功能
	- 拖拽分组
	- 批量关闭
	- 全部展开
	- 全量收起
	- 右键便签时，可固定标签页、标签组
	- 批量移动、(使用shift键可多选标签页)

## 快速开始

- vscode 插件市场中搜索 laikang287.vscode-verti
- 重启vscode
- 在vscode的活动栏的找到`VERTICAL TABS`图标，点击图标后，在展开的侧边栏中欧可以点击按钮来显示、关闭垂直标签页
	- 注:此 `VERTICAL TABS`活动栏可挪到挪到其它常用的活动栏内部，方遍使用
		- #todo 手续补充截图

## 如何切换界面语言

#todo 手续补充

## 原理

插件在 VS Code 启动后会创建一个 Webview，并在编辑器区域最左侧独占一个编辑器组，用来显示垂直标签页，然后使用vscode的锁定组功能进行锁定，锁定后，后续打开的新标签都会不会进入此编辑组

## 说明

1. 插件由AI编写
2. 文档以 README.zh-CN为准，其余语言版本由AI翻译

## 许可证

MIT License - 详见 [LICENSE](LICENSE)

## 如何手工安装插件

- github找到vscode-vertical-tabs-in-editor-area 仓库 releases 目录下找到最新版的.vsix，下载
	- github 仓库地址 [vscode-vertical-tabs-in-editor-area](https://github.com/laikang287/vscode-vertical-tabs-in-editor-area/tree/main/releases)
- 打开vscode——活动栏找到扩展——点击侧边栏右上角的三点查看，选择 从VISX 安装
