import type { ExtensionMessage, TabTarget, VerticalTabItem } from './messages';

declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const description = document.querySelector<HTMLParagraphElement>('#description');
const groups = document.querySelector<HTMLElement>('#groups');
const closeSaved = document.querySelector<HTMLButtonElement>('#close-saved');
let contextMenu: HTMLElement | undefined;

window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
  if (event.data.type === 'renderTabs') {
    render(event.data);
  }
});

closeSaved?.addEventListener('click', () => vscode.postMessage({ type: 'closeSaved' }));
document.addEventListener('click', () => dismissContextMenu());
window.addEventListener('blur', () => dismissContextMenu());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    dismissContextMenu();
  }
});

const resizeObserver = new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (width >= 180) {
    vscode.postMessage({ type: 'railWidth', width });
  }
});
resizeObserver.observe(document.documentElement);
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

  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, tab.target);
  });

  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  actions.append(actionButton('×', '关闭标签', 'closeTab', tab.target));
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

function showContextMenu(x: number, y: number, target: TabTarget): void {
  dismissContextMenu();
  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('click', (event) => event.stopPropagation());
  menu.append(
    actionButton('关闭其他标签', '关闭其他标签', 'closeOthers', target),
    actionButton('关闭下侧标签', '关闭下侧标签', 'closeBelow', target),
  );
  menu.querySelectorAll('button').forEach((button) => {
    button.classList.add('tab-context-action');
    button.addEventListener('click', dismissContextMenu, { once: true });
  });
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4))}px`;
  contextMenu = menu;
}

function dismissContextMenu(): void {
  contextMenu?.remove();
  contextMenu = undefined;
}
