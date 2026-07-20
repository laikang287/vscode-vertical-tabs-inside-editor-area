import type { ExtensionMessage, GroupMode, ManualTabGroup, SortMode, TabTarget, VerticalTabDisplayGroup, VerticalTabItem } from './messages';

declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const description = document.querySelector<HTMLParagraphElement>('#description');
const groups = document.querySelector<HTMLElement>('#groups');
const verticalTabs = document.querySelector<HTMLElement>('.vertical-tabs');
const groupModeSelect = document.querySelector<HTMLSelectElement>('#group-mode');
const sortModeSelect = document.querySelector<HTMLSelectElement>('#sort-mode');
let contextMenu: HTMLElement | undefined;
let latestSnapshot: Extract<ExtensionMessage, { type: 'renderTabs' }>['snapshot'] | undefined;
let draggedTarget: TabTarget | undefined;
let refreshAttempts = 0;

window.addEventListener('error', (event) => logToExtension('error', '脚本运行错误', `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`));
window.addEventListener('unhandledrejection', (event) => logToExtension('error', '脚本 Promise 未处理异常', stringifyDetails(event.reason)));
window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
  if (event.data.type === 'renderTabs') {
    logToExtension('debug', '收到标签渲染消息', `revision=${event.data.snapshot.revision}, tabs=${event.data.snapshot.tabs.length}`);
    render(event.data);
  }
});
verticalTabs?.addEventListener('contextmenu', (event) => { event.preventDefault(); showContextMenu(event.clientX, event.clientY); });
groupModeSelect?.addEventListener('change', () => vscode.postMessage({ type: 'setGroupMode', groupMode: groupModeSelect.value }));
sortModeSelect?.addEventListener('change', () => vscode.postMessage({ type: 'setSortMode', sortMode: sortModeSelect.value }));
document.addEventListener('click', () => dismissContextMenu());
window.addEventListener('blur', () => dismissContextMenu());
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') dismissContextMenu(); });
new ResizeObserver(([entry]) => { const width = Math.round(entry.contentRect.width); if (width >= 180) vscode.postMessage({ type: 'railWidth', width }); }).observe(document.documentElement);
logToExtension('debug', 'Webview 脚本已启动');
requestInitialSnapshot('ready');

function render(message: Extract<ExtensionMessage, { type: 'renderTabs' }>): void {
  if (!groups || !description) {
    logToExtension('error', '渲染标签失败：缺少必要 DOM 节点', `groups=${Boolean(groups)}, description=${Boolean(description)}`);
    return;
  }
  latestSnapshot = message.snapshot;
  groups.replaceChildren();
  const { tabs, displayGroups, groupMode, sortMode } = message.snapshot;
  if (groupModeSelect) groupModeSelect.value = groupMode;
  if (sortModeSelect) sortModeSelect.value = sortMode;
  description.textContent = tabs.length === 0 ? '没有可显示的编辑器标签。' : '';
  for (const group of displayGroups) appendDisplayGroup(groups, group);
}

function requestInitialSnapshot(type: 'ready' | 'requestRefresh'): void {
  logToExtension('debug', '请求标签快照', `type=${type}, attempt=${refreshAttempts + 1}`);
  vscode.postMessage({ type });
  refreshAttempts += 1;
  window.setTimeout(() => {
    if (!latestSnapshot && refreshAttempts < 5) {
      requestInitialSnapshot('requestRefresh');
    } else if (!latestSnapshot) {
      logToExtension('warn', '等待标签快照超时', `attempts=${refreshAttempts}`);
    }
  }, 500);
}

function logToExtension(level: 'debug' | 'warn' | 'error', message: string, details?: string): void {
  vscode.postMessage({ type: 'webviewLog', level, message, ...(details ? { details } : {}) });
}

function stringifyDetails(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendDisplayGroup(parent: HTMLElement, group: VerticalTabDisplayGroup): void {
  const section = document.createElement('section');
  section.className = ['tab-group', group.isManual ? 'is-manual' : '', group.showHeader ? '' : 'without-header'].filter(Boolean).join(' ');
  section.dataset.groupId = group.id;
  section.addEventListener('dragover', (event) => handleGroupDragOver(event, group));
  section.addEventListener('drop', (event) => handleGroupDrop(event, group));
  if (group.showHeader) {
    const header = document.createElement('header');
    header.className = 'group-header';
    if (group.isManual) {
      const toggle = button(group.collapsed ? '▶' : '▼', `${group.collapsed ? '展开' : '折叠'}分组`);
      toggle.addEventListener('click', () => vscode.postMessage({ type: 'toggleGroup', groupId: group.id }));
      header.append(toggle);
    }
    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.title;
    header.append(name);
    if (group.description) {
      const detail = document.createElement('span');
      detail.className = 'group-description';
      detail.textContent = group.description;
      header.append(detail);
    }
    if (group.isManual && group.id !== '__ungrouped') {
      const rename = button('重命名', '重命名分组');
      rename.addEventListener('click', () => {
        const value = window.prompt('分组名称', group.title);
        if (value?.trim()) vscode.postMessage({ type: 'renameGroup', groupId: group.id, name: value.trim() });
      });
      const remove = button('删除', '删除分组');
      remove.addEventListener('click', () => vscode.postMessage({ type: 'deleteGroup', groupId: group.id }));
      header.append(rename, remove);
    }
    section.append(header);
  }
  appendTabList(section, group.tabs, group);
  parent.append(section);
}

function appendTabList(parent: HTMLElement, tabs: readonly VerticalTabItem[], group: VerticalTabDisplayGroup): void {
  for (const tab of tabs) parent.append(createTab(tab, group));
}

function createTab(tab: VerticalTabItem, group: VerticalTabDisplayGroup): HTMLElement {
  const row = document.createElement('article');
  row.className = ['tab-row', tab.isActive ? 'is-active' : '', tab.isDirty ? 'is-dirty' : '', tab.isPinned ? 'is-pinned' : '', tab.isActivatable ? '' : 'is-unavailable'].filter(Boolean).join(' ');
  row.draggable = true;
  row.dataset.groupId = group.id;
  row.addEventListener('dragstart', (event) => {
    draggedTarget = tab.target;
    event.dataTransfer?.setData('application/x-vertical-tab-target', JSON.stringify(tab.target));
    event.dataTransfer?.setData('text/plain', tab.label);
    event.dataTransfer?.setDragImage(row, 8, 8);
  });
  row.addEventListener('dragend', () => { draggedTarget = undefined; });
  row.addEventListener('dragover', (event) => handleTabDragOver(event, group));
  row.addEventListener('drop', (event) => handleTabDrop(event, tab, group));
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
  row.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); showContextMenu(event.clientX, event.clientY, tab); });
  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  actions.append(actionButton('×', '关闭标签', 'closeTab', tab.target));
  row.append(activate, actions);
  return row;
}

function handleGroupDragOver(event: DragEvent, group: VerticalTabDisplayGroup): void {
  if (!draggedTarget || latestSnapshot?.groupMode === 'parentDir' || latestSnapshot?.groupMode === 'fileType') return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
  group;
}

function handleGroupDrop(event: DragEvent, group: VerticalTabDisplayGroup): void {
  if (!draggedTarget) return;
  event.preventDefault();
  const groupId = latestSnapshot?.groupMode === 'manual' && group.id !== '__ungrouped' ? group.id : undefined;
  vscode.postMessage({ type: 'moveTab', target: draggedTarget, groupId });
}

function handleTabDragOver(event: DragEvent, group: VerticalTabDisplayGroup): void {
  if (!draggedTarget || latestSnapshot?.groupMode === 'parentDir' || latestSnapshot?.groupMode === 'fileType') return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = group.mode === 'manual' || group.mode === 'vscode' ? 'move' : 'none';
}

function handleTabDrop(event: DragEvent, tab: VerticalTabItem, group: VerticalTabDisplayGroup): void {
  if (!draggedTarget) return;
  event.preventDefault();
  if (sameTarget(draggedTarget, tab.target)) return;
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const relativeY = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0;
  if (latestSnapshot?.groupMode === 'manual' && relativeY > 0.25 && relativeY < 0.75) {
    vscode.postMessage({ type: 'createGroupFromTabs', source: draggedTarget, target: tab.target });
    return;
  }
  const groupId = latestSnapshot?.groupMode === 'manual' && group.id !== '__ungrouped' ? group.id : undefined;
  vscode.postMessage({ type: 'moveTab', target: draggedTarget, groupId, beforeTarget: tab.target });
}

function button(label: string, title: string): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.textContent = label;
  result.title = title;
  return result;
}

function actionButton(label: string, title: string, type: 'closeTab' | 'closeOthers' | 'closeBelow', target: TabTarget, dismissAfterClick = false): HTMLButtonElement {
  const result = button(label, title);
  result.className = 'tab-action';
  result.addEventListener('click', () => { postTarget(type, target); if (dismissAfterClick) dismissContextMenu(); });
  return result;
}

function postTarget(type: 'activateTab' | 'closeTab' | 'closeOthers' | 'closeBelow', target: TabTarget): void { vscode.postMessage({ type, target }); }

function showContextMenu(x: number, y: number, tab?: VerticalTabItem): void {
  dismissContextMenu();
  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('click', (event) => event.stopPropagation());
  if (tab) {
    menu.append(
      actionButton('关闭其他标签', '关闭其他标签', 'closeOthers', tab.target, true),
      actionButton('关闭下侧标签', '关闭下侧标签', 'closeBelow', tab.target, true),
      messageButton(tab.isPinned ? '取消固定标签' : '固定标签', tab.isPinned ? '取消固定标签' : '固定标签', { type: tab.isPinned ? 'unpinTab' : 'pinTab', target: tab.target }),
    );
  }
  menu.append(
    createGroupButton(),
    globalActionButton('关闭已保存', '关闭已保存的标签', 'closeSaved'),
    globalActionButton('关闭全部', '关闭所有未固定标签', 'closeAll'),
  );
  const snapshot = latestSnapshot;
  if (tab && snapshot) {
    if (snapshot.groupMode === 'manual') appendManualGroupActions(menu, tab, snapshot.manualGroups);
    if (snapshot.groupMode === 'vscode') {
      menu.append(
        messageButton('移至上一组', '移至上一编辑器组', { type: 'moveToPreviousGroup', target: tab.target }),
        messageButton('移至下一组', '移至下一编辑器组', { type: 'moveToNextGroup', target: tab.target }),
        messageButton('移至新组', '移至新编辑器组', { type: 'moveToNewGroup', target: tab.target }),
      );
    }
  }
  menu.querySelectorAll('button').forEach((item) => item.classList.add('tab-context-action'));
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4))}px`;
  contextMenu = menu;
}

function appendManualGroupActions(menu: HTMLElement, tab: VerticalTabItem, manualGroups: readonly ManualTabGroup[]): void {
  for (const group of manualGroups) {
    const item = button(`移至：${group.name}`, `移至 ${group.name}`);
    item.addEventListener('click', () => {
      vscode.postMessage({ type: 'assignGroup', target: tab.target, groupId: group.id });
      dismissContextMenu();
    });
    menu.append(item);
  }
  if (tab.manualGroupId) {
    const item = button('移出分组', '移出分组');
    item.addEventListener('click', () => {
      vscode.postMessage({ type: 'assignGroup', target: tab.target });
      dismissContextMenu();
    });
    menu.append(item);
  }
}

function globalActionButton(label: string, title: string, type: 'closeSaved' | 'closeAll'): HTMLButtonElement {
  return messageButton(label, title, { type });
}

function createGroupButton(): HTMLButtonElement {
  const result = button('新建分组', '新建分组');
  result.addEventListener('click', () => {
    const name = window.prompt('分组名称');
    if (name?.trim()) vscode.postMessage({ type: 'createGroup', name: name.trim() });
    dismissContextMenu();
  });
  return result;
}

function messageButton(label: string, title: string, message: unknown): HTMLButtonElement {
  const result = button(label, title);
  result.addEventListener('click', () => {
    vscode.postMessage(message);
    dismissContextMenu();
  });
  return result;
}

function sameTarget(left: TabTarget, right: TabTarget): boolean {
  if (JSON.stringify(left.identity) === JSON.stringify(right.identity)) return true;
  return left.revision === right.revision && left.groupIndex === right.groupIndex && left.tabIndex === right.tabIndex;
}

function dismissContextMenu(): void {
  contextMenu?.remove();
  contextMenu = undefined;
}

type _GroupModeCheck = GroupMode;
type _SortModeCheck = SortMode;
