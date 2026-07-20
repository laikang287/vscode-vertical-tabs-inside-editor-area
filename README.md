# 编辑器区域垂直标签页

一个固定在 VS Code 编辑器区域左侧的垂直标签页扩展。

当前版本会在 VS Code 启动、安装后的窗口重载或下次启动时自动恢复垂直标签栏。它同步全部编辑器组的标签、支持同名文件路径消歧、文本/差异/Notebook/Custom Editor 切换，以及关闭、关闭其他、关闭下侧和关闭已保存操作。

使用 `Vertical Tabs: Focus` 或 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd>（macOS：<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd>）聚焦标签栏。终端和其他扩展的 Webview 会显示在列表中，但受 VS Code 公开 API 限制，不能从该列表跳转。

## 开发

```bash
npm install
npm run verify
```

验证通过后，VSIX 位于 `dist/`。
