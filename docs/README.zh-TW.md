# 編輯器區域垂直分頁

[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

在 VS Code <mark>編輯器區域左側</mark>顯示<mark>垂直分頁列</mark>，不使用主要側邊欄和次要側邊欄，因此分頁列可以一直保持可見。

```text
主要側邊欄 | 垂直分頁列 | 編輯器區域 | 次要側邊欄
```

## Demo

![](../media/demo.gif)

## 快速開始

- 從 VS Code 擴充功能市集安裝：
  - https://marketplace.visualstudio.com/items?itemName=laikang287.vertical-tabs-inside-editor-area
  - 註：Cursor、VSCodium、Google Antigravity、Qoder 等基於 VS Code 的 IDE，可從以下 Open VSX 頁面下載： [Vertical Tabs Inside Editor Area – Open VSX Registry](https://open-vsx.org/extension/laikang287/vertical-tabs-inside-editor-area)
- 重新啟動 VS Code。
- 點擊下圖任一按鈕即可顯示或隱藏垂直分頁：
  - ![](../assets/README.zh-CN/demo2.png)

## 擴充功能特色

- 垂直分頁方便開啟大量檔案。
- 垂直分頁列位於<mark>編輯器區域左側</mark>，不占用側邊欄，並保持可見。

## 功能說明

- **在編輯器區域左側顯示垂直分頁**
- 支援多種語言（i18n）
- 依 VS Code 原生群組、手動群組、檔案類型或父目錄分組
- 支援手動、名稱和時間排序
- 顯示或隱藏垂直分頁
- 基本分頁操作：
  - 拖曳至群組
  - 批次關閉
  - 全部展開
  - 全部收合
  - 按右鍵釘選分頁或群組
  - 批次移動（按住 Shift 多選）
- 按父目錄分組時，將檔案拖至其他群組會移動實際檔案。
- 可將分頁列設於左側或右側，並將搜尋、設定等按鈕設於頂部或底部。

## 切換介面語言

使用 `verticalTabs.language` 切換語言，預設值為 `auto`。

## 說明

1. 使用 LLM 輔助開發。
2. README.zh-CN.md 由人工維護，其餘 README 由 LLM 翻譯。

## 授權

MIT License - 詳見 [LICENSE](../LICENSE)

## 已知問題

- 安裝或更新其他擴充功能後，垂直分頁有時無法點擊；重新啟動 VS Code 即可。
  - 例 1：更新本擴充功能有時也會觸發此問題。
  - 例 2：安裝或更新 VIM 擴充功能（VSCodeVim 專案）會觸發此問題。
