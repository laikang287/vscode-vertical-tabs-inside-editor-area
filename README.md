# 编辑器区域垂直标签页

一个固定在 VS Code 编辑器区域左侧的垂直标签页扩展。

当前版本会在 VS Code 启动、安装后的窗口重载或下次启动时自动恢复垂直标签栏。它始终使用编辑器区域最左侧、独占且锁定的原生编辑器组；没有用户编辑器时，会先打开 VS Code 欢迎页。它同步全部用户编辑器组的标签、支持同名文件路径消歧、文本/差异/Notebook/Custom Editor 切换、手动分组、按父目录或文件类型分组，以及关闭、关闭其他、关闭下侧和关闭已保存操作。

使用 `Vertical Tabs: Focus` 或 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd>（macOS：<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd>）聚焦标签栏。活动栏的 Vertical Tabs 图标会打开一个启动器，可显示或关闭标签栏。首次宽度为编辑器区域的 20%，可通过 `verticalTabs.tabWidthRatio` 调整；之后会恢复上次拖动后的宽度比例。终端和其他扩展的 Webview 会显示在列表中，扩展会优先尝试通过 VS Code 内置编辑器导航定位已有标签。

扩展会将启动、布局、标签迁移、分组锁定和 Webview 消息等关键事件写入 `Vertical Tabs` 输出通道。当前代码中的 `ACTIVE_LOG_LEVEL` 固定为 `Debug`；发生问题时可从命令面板执行 `Vertical Tabs: Show Logs` 查看日志。

## 开发

```bash
npm install
npm run verify
```

验证通过后，VSIX 位于 `dist/`。
