
# 編輯器區域垂直標籤頁

```html
<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文（规范源）</a> ·
  <a href="docs/README.zh-TW.md">繁體中文</a> ·
  <a href="docs/README.ja.md">日本語</a> ·
  <a href="docs/README.ko.md">한국어</a> ·
  <a href="docs/README.es.md">Español</a> ·
  <a href="docs/README.fr.md">Français</a> ·
  <a href="docs/README.de.md">Deutsch</a> ·
  <a href="docs/README.ru.md">Русский</a>
</p>
```

在 VS Code <mark>編輯器區域左側</mark>顯示一個始終可見的<mark>垂直標籤欄</mark>，不佔用主側邊欄和輔助側邊欄。

介面佈局如下：

```text
主側邊欄 | 垂直標籤欄 | 編輯器區域 | 輔助側邊欄
```

## Demo

![demo.gif](media/demo.gif)

## 為什麼開發這個擴充

VS Code 預設使用橫向標籤欄。開啟大量檔案後，標籤名稱容易被截斷，尋找和切換檔案不夠直觀。

許多垂直標籤頁擴充將標籤列表放在主側邊欄中，但主側邊欄還需要顯示檔案總管、搜尋、原始碼管理和擴充等功能。

當使用者切換側邊欄功能時，垂直標籤頁也會隨之隱藏。

本擴充將垂直標籤欄放在編輯器區域左側，因此即使切換主側邊欄中的其他功能，垂直標籤頁仍然可以保持顯示。

## 適合族群

- 經常同時開啟大量檔案
- 螢幕擁有足夠的橫向空間
- 不希望垂直標籤頁佔用主側邊欄

## 功能說明

- **在編輯器區域左側顯示垂直標籤頁**
- 支援多種語言 (i18n)
- 支援標籤頁群組，包括自動分組和手動分組（按類型分組、按父目錄分組、跟隨 VS Code 橫向標籤欄）
- 支援標籤以手動排序、名稱排序、時間排序
- 可顯示、隱藏垂直標籤頁
- 支援標籤頁基礎功能：
	- 拖曳分組
	- 批次關閉
	- 全部展開
	- 全部收合
	- 右鍵便籤時，可固定標籤頁、標籤群組
	- 批次移動（使用 Shift 鍵可多選標籤頁）
- 分組類型為父目錄時，拖曳檔案到其他分組時，會移動實際檔案

## 快速開始

- 在 VS Code 擴充市場中搜尋 "Vertical Tabs Inside Editor Area" 進行安裝，擴充的 Identifier 為 `laikang287.vertical-tabs-inside-editor-area`
- 重啟 VS Code
- 在 VS Code 的活動欄找到 `VERTICAL TABS` 圖示，點擊圖示開啟檢視，可以點擊 Show、Hide 來顯示、隱藏垂直標籤頁
- 註 1：此 `VERTICAL TABS` 檢視可移動到其他常用的活動欄內部，方便使用
	- 上方 GIF 中有示範
- 註 2：使用本擴充時，建議保持 VS Code 的標籤換行功能關閉：

```json
{
  "workbench.editor.wrapTabs": false
}
```

## 如何切換介面語言

設定項目 `verticalTabs.language` 可切換擴充的語言，預設值為 `auto`

## 原理

擴充啟動後會建立一個 Webview，並將其放置在編輯器區域最左側的獨立編輯器群組中。

該 Webview 用於顯示垂直標籤頁。

擴充隨後會使用 VS Code 的編輯器群組鎖定功能鎖定該編輯器群組，避免後續開啟的新檔案進入垂直標籤欄所在的編輯器群組。

## 說明

1. 本專案在開發過程中使用 AI 程式設計工具輔助完成程式碼編寫、測試和文件整理
2. 文件以 README.zh-CN 為準，其餘語言版本由 AI 翻譯
3. 簡體中文文件是本專案的主要維護版本

## 授權條款

MIT License - 詳見 [LICENSE](LICENSE)

## 如何手動安裝擴充

- 在 GitHub 的 [vscode-vertical-tabs-inside-editor-area](https://github.com/laikang287/vscode-vertical-tabs-inside-editor-area/tree/main/releases) 倉庫的 releases 目錄下找到最新版的 .vsix 並下載
- 開啟 VS Code → 活動欄找到擴充 → 點擊側邊欄右上角的三點選單 → 選擇「從 VSIX 安裝...」
