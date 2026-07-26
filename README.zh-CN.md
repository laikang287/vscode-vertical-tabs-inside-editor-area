# 编辑器区域垂直标签页

[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

在 VS Code <mark>编辑器区域左侧</mark>显示一个始终可见的<mark>垂直标签栏</mark>，不占用主侧边栏和辅助侧边栏。

界面布局如下：

```text
主侧边栏 | 垂直标签栏 | 编辑器区域 | 辅助侧边栏
```

## demo

![demo.gif](media/demo.gif)

## 为什么开发这个扩展

VS Code 默认使用横向标签栏。打开大量文件后，标签名称容易被截断，查找和切换文件不够直观。

许多垂直标签页扩展将标签列表放在主侧边栏中，但主侧边栏还需要显示文件资源管理器、搜索、源代码管理和扩展等功能。

当用户切换侧边栏功能时，垂直标签页也会随之隐藏。

本扩展将垂直标签栏放在编辑器区域左侧，因此即使切换主侧边栏中的其他功能，垂直标签页仍然可以保持显示。

## 适合人群

- 经常同时打开大量文件
- 屏幕拥有足够的横向空间
- 不希望垂直标签页占用主侧边栏

## 功能说明

- **在编辑器区域左侧显示垂直标签页**
- 支持多种语言(i18n)
- 支持标签页组，有包括自动分组手动分组（按类型分组、按父目录分组、跟随vscode横向标签栏）
- 支持标签以手工排序、名称排序、时间排序
- 可显示、隐藏垂直标签页
- 支持标签页基础功能
	- 拖拽分组
	- 批量关闭
	- 全部展开
	- 全量收起
	- 右键便签时，可固定标签页、标签组
	- 批量移动、(使用shift键可多选标签页)
- 分组类型为父目录时，拖拽文件到其它分组时，会移动实际文件

## 快速开始

- vscode 插件市场中搜索 Vertical Tabs Inside Editor Area 进行安装，插件的 Identifier 为 laikang287.vertical-tabs-inside-editor-area
- 重启vscode
- 在vscode的活动栏的找到`VERTICAL TABS`图标，点击图标打开视图，可以点击Show、Hide来显示、隐藏垂直标签页
- 注1:此 `VERTICAL TABS`视图可挪到挪到其它常用的活动栏内部，方遍使用
	- 上面gif中有演示
- 注2用本插件时，建议保持 VS Code 的标签换行功能关闭：

```json
{
  "workbench.editor.wrapTabs": false
}
```

## 如何切换界面语言

配置项 verticalTabs.language 可切换插件的语言，默认值为auto

## 原理

扩展启动后会创建一个 Webview，并将其放置在编辑器区域最左侧的独立编辑器组中。

该 Webview 用于显示垂直标签页。

扩展随后会使用 VS Code 的编辑器组锁定功能锁定该编辑器组，避免后续打开的新文件进入垂直标签栏所在的编辑器组。

## 说明

1. 本项目在开发过程中使用了 AI 编程工具辅助完成代码编写、测试和文档整理
2. 文档以 README.zh-CN为准，其余语言版本由AI翻译
3. 简体中文文档是本项目的主要维护版本
4. 这个插件是用一种间接的方式来实现的，属于投机取巧，最好的方案还是官方自己能够支持，希望大家到vscode的相关议题点赞，希望官方重视这个议题
		[Add support for vertical tabs · Issue #108264 · microsoft/vscode](https://github.com/microsoft/vscode/issues/108264)

## 许可证

MIT License - 详见 [LICENSE](LICENSE)

## 如何手工安装插件

- github找到 vscode-vertical-tabs-inside-editor-area 仓库 releases 目录下找到最新版的.vsix，下载
	- github 仓库地址 [vscode-vertical-tabs-inside-editor-area](https://github.com/laikang287/vscode-vertical-tabs-inside-editor-area/tree/main/releases)
- 打开vscode——活动栏找到扩展——点击侧边栏右上角的三点查看，选择 从VISX 安装

## 已知问题

1. 更新、安装其它插件时，垂直标签页有时会无法点击标签页中的标签，重启vscode即可

示例1：更新本插件有时也会触发此问题
示例2：安装、更新 VIM(VSCoceVim项目)插件 会触发此问题
