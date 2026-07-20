import type { ExtensionMessage, WebviewMessage } from './messages';

declare const acquireVsCodeApi: () => { postMessage(message: WebviewMessage): void };

const vscode = acquireVsCodeApi();
const description = document.querySelector<HTMLParagraphElement>('#description');

window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
  if (event.data.type === 'renderPlaceholder' && description) {
    description.textContent = `${event.data.title} 已就绪。标签同步、分组与位置切换将在后续版本提供。`;
  }
});

vscode.postMessage({ type: 'ready' });
