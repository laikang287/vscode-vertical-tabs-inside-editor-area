import type { ExtensionMessage, TabTarget, VerticalTabItem } from './messages';

declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const description = document.querySelector<HTMLParagraphElement>('#description');
const groups = document.querySelector<HTMLElement>('#groups');
const closeSaved = document.querySelector<HTMLButtonElement>('#close-saved');

window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
  if (event.data.type === 'renderTabs') {
    render(event.data);
  }
});

closeSaved?.addEventListener('click', () => vscode.postMessage({ type: 'closeSaved' }));
vscode.postMessage({ type: 'ready' });

function render(message: Extract<ExtensionMessage, { type: 'renderTabs' }>): void {
  if (!groups || !description) {
    return;
  }
  groups.replaceChildren();
  description.textContent = message.snapshot.groups.length === 0 ? '没有可显示的编辑器标签。' : '';

  for (const group of message.snapshot.groups) {
    const section = document.createElement('section');
    section.className = `tab-group${group.isActive ? ' is-active-group' : ''}`;
    const heading = document.createElement('h2');
    heading.textContent = `编辑器组 ${group.viewColumn}`;
    section.append(heading);

    for (const tab of group.tabs) {
      section.append(createTab(tab));
    }
    groups.append(section);
  }
}

function createTab(tab: VerticalTabItem): HTMLElement {
  const row = document.createElement('article');
  row.className = [
    'tab-row',
    tab.isActive ? 'is-active' : '',
    tab.isDirty ? 'is-dirty' : '',
    tab.isActivatable ? '' : 'is-unavailable',
  ].filter(Boolean).join(' ');

  const activate = document.createElement('button');
  activate.className = 'tab-main';
  activate.type = 'button';
  activate.disabled = !tab.isActivatable;
  activate.title = tab.isActivatable ? tab.label : `${tab.label} 无法由扩展跳转`;
  activate.addEventListener('click', () => postTarget('activateTab', tab.target));

  const label = document.createElement('span');
  label.className = 'tab-label';
  label.textContent = `${tab.isDirty ? '● ' : ''}${tab.label}${tab.isPinned ? ' 📌' : ''}${tab.isPreview ? ' (预览)' : ''}`;
  activate.append(label);
  if (tab.description) {
    const detail = document.createElement('span');
    detail.className = 'tab-description';
    detail.textContent = tab.description;
    activate.append(detail);
  }

  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  actions.append(
    actionButton('×', '关闭标签', 'closeTab', tab.target),
    actionButton('其', '关闭其他标签', 'closeOthers', tab.target),
    actionButton('下', '关闭下侧标签', 'closeBelow', tab.target),
  );
  row.append(activate, actions);
  return row;
}

function actionButton(label: string, title: string, type: 'closeTab' | 'closeOthers' | 'closeBelow', target: TabTarget): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'tab-action';
  button.type = 'button';
  button.title = title;
  button.ariaLabel = title;
  button.textContent = label;
  button.addEventListener('click', () => postTarget(type, target));
  return button;
}

function postTarget(type: 'activateTab' | 'closeTab' | 'closeOthers' | 'closeBelow', target: TabTarget): void {
  vscode.postMessage({ type, target });
}
