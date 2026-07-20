import type { ExtensionMessage, ManualTabGroup, TabTarget, VerticalTabItem } from './messages';
declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const description = document.querySelector<HTMLParagraphElement>('#description');
const groups = document.querySelector<HTMLElement>('#groups');
const closeSaved = document.querySelector<HTMLButtonElement>('#close-saved');
const addGroup = document.querySelector<HTMLButtonElement>('#add-group');
let contextMenu: HTMLElement | undefined;
window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => { if (event.data.type === 'renderTabs') render(event.data); });
closeSaved?.addEventListener('click', () => vscode.postMessage({ type: 'closeSaved' }));
addGroup?.addEventListener('click', () => {
  const name = window.prompt('分组名称');
  if (name?.trim()) vscode.postMessage({ type: 'createGroup', name: name.trim() });
});
document.addEventListener('click', () => dismissContextMenu());
window.addEventListener('blur', () => dismissContextMenu());
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') dismissContextMenu(); });
new ResizeObserver(([entry]) => { const width = Math.round(entry.contentRect.width); if (width >= 180) vscode.postMessage({ type: 'railWidth', width }); }).observe(document.documentElement);
vscode.postMessage({ type: 'ready' });

function render(message: Extract<ExtensionMessage, { type: 'renderTabs' }>): void {
  if (!groups || !description) return;
  latestSnapshot = message.snapshot;
  groups.replaceChildren();
  const { tabs, manualGroups } = message.snapshot;
  description.textContent = tabs.length === 0 ? '没有可显示的编辑器标签。' : '';
  const assigned = new Set(manualGroups.map((group) => group.id));
  appendTabList(groups, tabs.filter((tab) => !tab.manualGroupId || !assigned.has(tab.manualGroupId)));
  for (const group of manualGroups) appendGroup(groups, group, tabs.filter((tab) => tab.manualGroupId === group.id));
}
function appendGroup(parent: HTMLElement, group: ManualTabGroup, tabs: readonly VerticalTabItem[]): void {
  const section = document.createElement('section'); section.className = 'manual-group';
  const header = document.createElement('header'); header.className = 'group-header';
  const toggle = button(group.collapsed ? '▶' : '▼', `${group.collapsed ? '展开' : '折叠'}分组`);
  toggle.addEventListener('click', () => vscode.postMessage({ type: 'toggleGroup', groupId: group.id }));
  const name = document.createElement('span'); name.className = 'group-name'; name.textContent = group.name;
  const rename = button('重命名', '重命名分组'); rename.addEventListener('click', () => { const value = window.prompt('分组名称', group.name); if (value?.trim()) vscode.postMessage({ type: 'renameGroup', groupId: group.id, name: value.trim() }); });
  const remove = button('删除', '删除分组'); remove.addEventListener('click', () => vscode.postMessage({ type: 'deleteGroup', groupId: group.id }));
  header.append(toggle, name, rename, remove); section.append(header);
  if (!group.collapsed) appendTabList(section, tabs);
  parent.append(section);
}
function appendTabList(parent: HTMLElement, tabs: readonly VerticalTabItem[]): void { for (const tab of tabs) parent.append(createTab(tab)); }
function createTab(tab: VerticalTabItem): HTMLElement {
  const row = document.createElement('article'); row.className = ['tab-row', tab.isActive ? 'is-active' : '', tab.isDirty ? 'is-dirty' : '', tab.isActivatable ? '' : 'is-unavailable'].filter(Boolean).join(' ');
  const activate = document.createElement('button'); activate.className = 'tab-main'; activate.type = 'button'; activate.disabled = !tab.isActivatable; activate.title = tab.isActivatable ? tab.label : `${tab.label} 无法由扩展跳转`;
  activate.addEventListener('click', () => postTarget('activateTab', tab.target));
  const label = document.createElement('span'); label.className = 'tab-label'; label.textContent = `${tab.isDirty ? '● ' : ''}${tab.label}${tab.isPinned ? ' 📌' : ''}${tab.isPreview ? ' (预览)' : ''}`; activate.append(label);
  if (tab.description) { const detail = document.createElement('span'); detail.className = 'tab-description'; detail.textContent = tab.description; activate.append(detail); }
  row.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); showContextMenu(event.clientX, event.clientY, tab); });
  const actions = document.createElement('div'); actions.className = 'tab-actions'; actions.append(actionButton('×', '关闭标签', 'closeTab', tab.target)); row.append(activate, actions); return row;
}
function button(label: string, title: string): HTMLButtonElement { const result = document.createElement('button'); result.type = 'button'; result.textContent = label; result.title = title; return result; }
function actionButton(label: string, title: string, type: 'closeTab' | 'closeOthers' | 'closeBelow', target: TabTarget, dismissAfterClick = false): HTMLButtonElement {
  const result = button(label, title); result.className = 'tab-action';
  result.addEventListener('click', () => { postTarget(type, target); if (dismissAfterClick) dismissContextMenu(); });
  return result;
}
function postTarget(type: 'activateTab' | 'closeTab' | 'closeOthers' | 'closeBelow', target: TabTarget): void { vscode.postMessage({ type, target }); }
function showContextMenu(x: number, y: number, tab: VerticalTabItem): void {
  dismissContextMenu(); const menu = document.createElement('div'); menu.className = 'tab-context-menu'; menu.setAttribute('role', 'menu'); menu.addEventListener('click', (event) => event.stopPropagation());
  menu.append(actionButton('关闭其他标签', '关闭其他标签', 'closeOthers', tab.target, true), actionButton('关闭下侧标签', '关闭下侧标签', 'closeBelow', tab.target, true));
  const snapshot = latestSnapshot; if (snapshot) {
    for (const group of snapshot.manualGroups) { const item = button(`移至：${group.name}`, `移至 ${group.name}`); item.addEventListener('click', () => { vscode.postMessage({ type: 'assignGroup', target: tab.target, groupId: group.id }); dismissContextMenu(); }); menu.append(item); }
    if (tab.manualGroupId) { const item = button('移出分组', '移出分组'); item.addEventListener('click', () => { vscode.postMessage({ type: 'assignGroup', target: tab.target }); dismissContextMenu(); }); menu.append(item); }
  }
  menu.querySelectorAll('button').forEach((item) => item.classList.add('tab-context-action')); document.body.append(menu); const bounds = menu.getBoundingClientRect(); menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4))}px`; menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4))}px`; contextMenu = menu;
}
let latestSnapshot: Extract<ExtensionMessage, { type: 'renderTabs' }>['snapshot'] | undefined;
function dismissContextMenu(): void { contextMenu?.remove(); contextMenu = undefined; }
