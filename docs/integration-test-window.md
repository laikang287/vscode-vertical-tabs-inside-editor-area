# 集成测试窗口配置

Windows 上运行 `npm run test:integration` 或 `npm run verify` 时，测试脚本默认会识别当前前台激活窗口所在的显示器，把 Extension Host 窗口移动到其它显示器，并阻止该窗口成为系统前台窗口。

先运行以下命令查看当前显示器名称和可用工作区：

```powershell
npm run test:displays
```

将 `scripts/integration-test-window.example.json` 复制为仓库根目录的 `.vscode-test-window.json`，然后按本机布局修改：

```json
{
  "enabled": true,
  "preventFocus": true,
  "display": "auto",
  "x": 24,
  "y": 24,
  "width": 1600,
  "height": 900
}
```

- `display` 默认为 `auto`，会避开测试启动时前台激活窗口所在的显示器，并从其它能容纳配置矩形的显示器中选择可用工作区最大的一个。
- `display` 也可填写 `primary` 或 `test:displays` 输出的名称（例如 `DISPLAY3`），以固定测试窗口位置。
- `x`、`y` 是相对于目标显示器可用工作区左上角的坐标。
- `width`、`height` 是窗口尺寸，最小为 `640x480`。
- `preventFocus` 为 `true` 时，窗口保持可见但不可取得系统前台焦点。
- `enabled` 为 `false` 时，测试按原有方式启动窗口。

只有一块显示器时，`auto` 会安全回退到该显示器并继续阻止窗口抢占焦点。配置字段无效、显式指定的目标显示器不存在，或没有可避让且能容纳配置矩形的显示器时，测试会在启动 VS Code 前失败，以免窗口意外出现在当前使用的屏幕。
