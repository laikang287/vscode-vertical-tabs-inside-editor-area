import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { SingletonPanel } from './SingletonPanel';
import { ExtensionMessage, parseWebviewMessage } from './messages';

const VIEW_TYPE = 'verticalTabs.editorArea';
const TITLE = 'Vertical Tabs';

export class VerticalTabsPanel {
  private static readonly panels = new SingletonPanel<VerticalTabsPanel>();

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel.webview.html = this.createHtml();
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message)),
    );
  }

  static show(extensionUri: vscode.Uri): void {
    VerticalTabsPanel.panels.show(
      () => {
        const panel = vscode.window.createWebviewPanel(
          VIEW_TYPE,
          TITLE,
          { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
          {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out'), vscode.Uri.joinPath(extensionUri, 'media')],
            retainContextWhenHidden: true,
          },
        );
        return new VerticalTabsPanel(panel, extensionUri);
      },
      (existingPanel) => existingPanel.reveal(),
    );
  }

  static dispose(): void {
    VerticalTabsPanel.panels.current?.close();
  }

  private dispose(): void {
    VerticalTabsPanel.panels.clear(this);
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private reveal(): void {
    this.panel.reveal(vscode.ViewColumn.One, true);
  }

  private close(): void {
    this.panel.dispose();
  }

  private handleMessage(value: unknown): void {
    const message = parseWebviewMessage(value);
    if (!message) {
      return;
    }

    if (message.type === 'ready' || message.type === 'requestRefresh') {
      this.postMessage({ type: 'renderPlaceholder', title: TITLE });
    }
  }

  private postMessage(message: ExtensionMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private createHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'));
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'vertical-tabs.css'));
    const nonce = crypto.randomBytes(16).toString('base64');
    const cspSource = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>${TITLE}</title>
</head>
<body>
  <main class="vertical-tabs" aria-live="polite">
    <h1>${TITLE}</h1>
    <p id="description">正在初始化垂直标签页…</p>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
