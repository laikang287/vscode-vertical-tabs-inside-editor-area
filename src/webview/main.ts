import type { ExtensionMessage, GroupMode, ManualTabGroup, SortMode, TabTarget, VerticalTabDisplayGroup, VerticalTabItem } from './messages';

declare const acquireVsCodeApi: () => { getState(): WebviewState | undefined; postMessage(message: unknown): void; setState(state: WebviewState): void };

interface WebviewState {
  readonly collapsedGroups?: readonly string[];
}

const vscode = acquireVsCodeApi();
const description = document.querySelector<HTMLParagraphElement>('#description');
const groups = document.querySelector<HTMLElement>('#groups');
const verticalTabs = document.querySelector<HTMLElement>('.vertical-tabs');
const groupModeSelect = document.querySelector<HTMLSelectElement>('#group-mode');
const sortModeSelect = document.querySelector<HTMLSelectElement>('#sort-mode');
const expandAllButton = document.querySelector<HTMLButtonElement>('#expand-all');
const collapseAllButton = document.querySelector<HTMLButtonElement>('#collapse-all');
const collapsedGroups = new Set(vscode.getState()?.collapsedGroups ?? []);
let contextMenu: HTMLElement | undefined;
let latestSnapshot: Extract<ExtensionMessage, { type: 'renderTabs' }>['snapshot'] | undefined;
let draggedTarget: TabTarget | undefined;
let refreshAttempts = 0;
let activateRequestSequence = 0;
let dragRequestSequence = 0;

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
expandAllButton?.addEventListener('click', () => setAllGroupsCollapsed(false));
collapseAllButton?.addEventListener('click', () => setAllGroupsCollapsed(true));
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
  updateTreeActionState();
  vscode.postMessage({ type: 'renderAck', revision: message.snapshot.revision });
  logToExtension('debug', '标签渲染完成并发送确认', `revision=${message.snapshot.revision}, tabs=${tabs.length}, groups=${displayGroups.length}`);
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
      window.setTimeout(() => {
        if (!latestSnapshot) {
          requestInitialSnapshot('requestRefresh');
        }
      }, 2000);
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
  const collapsed = isGroupCollapsed(group);
  section.className = ['tab-group', group.showHeader ? 'with-header' : 'without-header', collapsed ? 'is-collapsed' : ''].filter(Boolean).join(' ');
  section.dataset.groupId = group.id;
  section.addEventListener('dragover', (event) => handleGroupDragOver(event, group));
  section.addEventListener('drop', (event) => handleGroupDrop(event, group));
  if (group.showHeader) {
    const header = document.createElement('header');
    header.className = 'group-header';
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', String(!collapsed));
    header.title = `${collapsed ? '展开' : '折叠'}分组`;
    header.addEventListener('click', () => toggleDisplayGroup(group));
    header.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, undefined, group);
    });
    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleDisplayGroup(group);
    });
    const main = document.createElement('div');
    main.className = 'group-main';
    const toggle = button(collapsed ? '▶' : '▼', `${collapsed ? '展开' : '折叠'}分组`);
    toggle.className = 'group-toggle';
    toggle.tabIndex = -1;
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleDisplayGroup(group);
    });
    main.append(toggle);
    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.title;
    main.append(name);
    if (group.description) {
      const detail = document.createElement('span');
      detail.className = 'group-description';
      detail.textContent = group.description;
      main.append(detail);
    }
    header.append(main);
    if (group.isManual && group.id !== '__ungrouped') {
      const actions = document.createElement('div');
      actions.className = 'group-actions';
      const remove = button('×', '删除分组');
      remove.className = 'group-action tab-action';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: 'deleteGroup', groupId: group.id });
      });
      actions.append(remove);
      header.append(actions);
    }
    section.append(header);
  }
  if (!collapsed) appendTabList(section, group.tabs, group, group.showHeader ? 1 : 0);
  parent.append(section);
}

function appendTabList(parent: HTMLElement, tabs: readonly VerticalTabItem[], group: VerticalTabDisplayGroup, level: 0 | 1): void {
  for (const tab of tabs) parent.append(createTab(tab, group, level));
}

function createTab(tab: VerticalTabItem, group: VerticalTabDisplayGroup, level: 0 | 1): HTMLElement {
  const row = document.createElement('article');
  row.className = ['tab-row', `tree-level-${level}`, tab.isActive ? 'is-active' : '', tab.isDirty ? 'is-dirty' : '', tab.isPinned ? 'is-pinned' : '', tab.isActivatable ? '' : 'is-unavailable'].filter(Boolean).join(' ');
  row.draggable = true;
  row.dataset.groupId = group.id;
  row.dataset.target = JSON.stringify(tab.target);
  row.addEventListener('dragstart', (event) => {
    draggedTarget = tab.target;
    const requestId = nextDragRequestId();
    row.dataset.dragRequestId = requestId;
    logToExtension('debug', '标签拖拽开始', targetDetails(tab.target, tab.label, requestId));
    event.dataTransfer?.setData('application/x-vertical-tab-target', JSON.stringify(tab.target));
    event.dataTransfer?.setData('application/x-vertical-tab-drag-request', requestId);
    event.dataTransfer?.setData('text/plain', tab.label);
    event.dataTransfer?.setDragImage(row, 8, 8);
  });
  row.addEventListener('dragend', (event) => {
    logToExtension('debug', '标签拖拽结束', targetDetails(tab.target, tab.label, row.dataset.dragRequestId));
    draggedTarget = undefined;
    delete row.dataset.dragRequestId;
    event.preventDefault();
  });
  row.addEventListener('dragover', (event) => handleTabDragOver(event, group));
  row.addEventListener('drop', (event) => handleTabDrop(event, tab, group));
  const activate = document.createElement('button');
  activate.className = 'tab-main';
  activate.type = 'button';
  activate.disabled = !tab.isActivatable;
  activate.title = activationTitle(tab);
  activate.addEventListener('pointerdown', () => {
    logToExtension('debug', '标签激活按钮 pointerdown', targetDetails(tab.target, tab.label));
  });
  activate.addEventListener('click', () => {
    const requestId = nextActivateRequestId();
    logToExtension('debug', '标签激活按钮 click，发送激活请求', targetDetails(tab.target, tab.label, requestId));
    markActiveTab(tab.target);
    vscode.postMessage({ type: 'activateTab', target: tab.target, requestId });
  });
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

function toggleDisplayGroup(group: VerticalTabDisplayGroup): void {
  setDisplayGroupCollapsed(group, !isGroupCollapsed(group));
}

function setAllGroupsCollapsed(collapsed: boolean): void {
  const snapshot = latestSnapshot;
  if (!snapshot) return;
  for (const group of snapshot.displayGroups) {
    if (group.showHeader) setDisplayGroupCollapsed(group, collapsed, false);
  }
  saveCollapsedGroups();
  render({ type: 'renderTabs', title: 'Vertical Tabs', snapshot });
}

function setDisplayGroupCollapsed(group: VerticalTabDisplayGroup, collapsed: boolean, rerender = true): void {
  const closedKey = groupCollapseKey(group);
  const openKey = openGroupCollapseKey(group);
  collapsedGroups.delete(collapsed ? openKey : closedKey);
  collapsedGroups.add(collapsed ? closedKey : openKey);
  saveCollapsedGroups();
  if (rerender && latestSnapshot) render({ type: 'renderTabs', title: 'Vertical Tabs', snapshot: latestSnapshot });
}

function isGroupCollapsed(group: VerticalTabDisplayGroup): boolean {
  if (collapsedGroups.has(groupCollapseKey(group))) return true;
  if (collapsedGroups.has(openGroupCollapseKey(group))) return false;
  return group.collapsed;
}

function groupCollapseKey(group: VerticalTabDisplayGroup): string {
  return `${group.mode}:${group.id}:closed`;
}

function openGroupCollapseKey(group: VerticalTabDisplayGroup): string {
  return `${group.mode}:${group.id}:open`;
}

function saveCollapsedGroups(): void {
  vscode.setState({ collapsedGroups: Array.from(collapsedGroups) });
}

function updateTreeActionState(): void {
  const groupsWithHeaders = latestSnapshot?.displayGroups.filter((group) => group.showHeader) ?? [];
  const hasGroups = groupsWithHeaders.length > 0;
  if (expandAllButton) expandAllButton.disabled = !hasGroups;
  if (collapseAllButton) collapseAllButton.disabled = !hasGroups;
}

function activationTitle(tab: VerticalTabItem): string {
  const title = tab.tooltipPath ?? tab.label;
  if (tab.activationKind === 'reliable') return title;
  if (tab.activationKind === 'bestEffort') return `${title}：使用 VS Code 内置导航命令尝试跳转`;
  return `${title} 无法由扩展跳转`;
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
  logToExtension('debug', '标签拖拽投放到分组', dropDetails(event, draggedTarget, group.id));
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
  const groupId = latestSnapshot?.groupMode === 'manual' && group.id !== '__ungrouped' ? group.id : undefined;
  logToExtension('debug', '标签拖拽排序请求', dropDetails(event, draggedTarget, group.id, tab.target));
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

function nextActivateRequestId(): string {
  activateRequestSequence = (activateRequestSequence % Number.MAX_SAFE_INTEGER) + 1;
  return `activate-${activateRequestSequence}`;
}

function nextDragRequestId(): string {
  dragRequestSequence = (dragRequestSequence % Number.MAX_SAFE_INTEGER) + 1;
  return `drag-${dragRequestSequence}`;
}

function targetDetails(target: TabTarget, label: string, requestId?: string): string {
  return [
    requestId ? `requestId=${requestId}` : undefined,
    `label=${label}`,
    `revision=${target.revision}`,
    `groupIndex=${target.groupIndex}`,
    `tabIndex=${target.tabIndex}`,
    `kind=${target.identity.kind}`,
  ].filter(Boolean).join(', ');
}

function dropDetails(event: DragEvent, source: TabTarget, groupId: string, beforeTarget?: TabTarget): string {
  return [
    `requestId=${event.dataTransfer?.getData('application/x-vertical-tab-drag-request') || 'unknown'}`,
    `sourceRevision=${source.revision}`,
    `sourceGroupIndex=${source.groupIndex}`,
    `sourceTabIndex=${source.tabIndex}`,
    `sourceKind=${source.identity.kind}`,
    `groupId=${groupId}`,
    beforeTarget ? `beforeGroupIndex=${beforeTarget.groupIndex}` : undefined,
    beforeTarget ? `beforeTabIndex=${beforeTarget.tabIndex}` : undefined,
    beforeTarget ? `beforeKind=${beforeTarget.identity.kind}` : undefined,
  ].filter(Boolean).join(', ');
}

function showContextMenu(x: number, y: number, tab?: VerticalTabItem, group?: VerticalTabDisplayGroup): void {
  dismissContextMenu();
  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('click', (event) => event.stopPropagation());
  if (group?.isManual && group.id !== '__ungrouped') {
    menu.append(renameGroupButton(group));
  }
  if (tab) {
    menu.append(
      actionButton('关闭其他标签', '关闭其他标签', 'closeOthers', tab.target, true),
      actionButton('关闭下侧标签', '关闭下侧标签', 'closeBelow', tab.target, true),
      messageButton(tab.isPinned ? '取消固定标签' : '固定标签', tab.isPinned ? '取消固定标签' : '固定标签', { type: tab.isPinned ? 'unpinTab' : 'pinTab', target: tab.target }),
    );
  }
  const snapshot = latestSnapshot;
  menu.append(
    createGroupButton(snapshot?.groupMode === 'manual'),
    globalActionButton('关闭已保存', '关闭已保存的标签', 'closeSaved'),
    globalActionButton('关闭全部', '关闭所有未固定标签', 'closeAll'),
  );
  if (tab && snapshot) {
    if (snapshot.groupMode === 'manual') appendManualGroupActions(menu, tab, snapshot.manualGroups);
    if (snapshot.groupMode === 'vscode') {
      menu.append(
        messageButton('移至上一组', '移至上一编辑器组', { type: 'moveToPreviousGroup', target: tab.target }),
        messageButton('移至下一组', '移至下一编辑器组', { type: 'moveToNextGroup', target: tab.target }),
      );
      appendVsCodeGroupActions(menu, tab, snapshot.displayGroups);
    }
  }
  menu.querySelectorAll('button').forEach((item) => item.classList.add('tab-context-action'));
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4))}px`;
  contextMenu = menu;
}

function renameGroupButton(group: VerticalTabDisplayGroup): HTMLButtonElement {
  const result = button('重命名', '重命名分组');
  result.addEventListener('click', () => {
    const value = window.prompt('分组名称', group.title);
    if (value?.trim()) vscode.postMessage({ type: 'renameGroup', groupId: group.id, name: value.trim() });
    dismissContextMenu();
  });
  return result;
}

function appendManualGroupActions(menu: HTMLElement, tab: VerticalTabItem, manualGroups: readonly ManualTabGroup[]): void {
  appendGroupSubmenu(menu, '移至分组', '移动到手动分组', (submenu, trigger) => {
    for (const group of manualGroups) {
      const item = button(group.name, `移至 ${group.name}`);
      item.addEventListener('click', () => {
        vscode.postMessage({ type: 'assignGroup', target: tab.target, groupId: group.id });
        dismissContextMenu();
      });
      submenu.append(item);
    }
    if (tab.manualGroupId) {
      const item = button('移出分组', '移出分组');
      item.addEventListener('click', () => {
        vscode.postMessage({ type: 'assignGroup', target: tab.target });
        dismissContextMenu();
      });
      submenu.append(item);
    }
    if (submenu.childElementCount === 0) trigger.disabled = true;
  });
}

function appendVsCodeGroupActions(menu: HTMLElement, tab: VerticalTabItem, displayGroups: readonly VerticalTabDisplayGroup[]): void {
  appendGroupSubmenu(menu, '移至分组', '移动到 VS Code 编辑器组', (submenu, trigger) => {
    for (const group of displayGroups) {
      if (group.mode !== 'vscode' || group.tabs.some((candidate) => sameTarget(candidate.target, tab.target))) continue;
      const firstTarget = group.tabs[0]?.target;
      if (!firstTarget) continue;
      const item = button(group.title, `移至 ${group.title}`);
      item.addEventListener('click', () => {
        vscode.postMessage({ type: 'moveToGroup', target: tab.target, groupIndex: firstTarget.groupIndex });
        dismissContextMenu();
      });
      submenu.append(item);
    }
    if (submenu.childElementCount === 0) trigger.disabled = true;
  });
}

function appendGroupSubmenu(menu: HTMLElement, label: string, title: string, fill: (submenu: HTMLElement, trigger: HTMLButtonElement) => void): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'tab-context-submenu';
  const trigger = button(label, title);
  trigger.className = 'tab-context-submenu-trigger';
  const submenu = document.createElement('div');
  submenu.className = 'tab-context-submenu-list';
  submenu.setAttribute('role', 'menu');
  fill(submenu, trigger);
  wrapper.append(trigger, submenu);
  menu.append(wrapper);
}

function globalActionButton(label: string, title: string, type: 'closeSaved' | 'closeAll'): HTMLButtonElement {
  return messageButton(label, title, { type });
}

function createGroupButton(enabled: boolean): HTMLButtonElement {
  const result = button('新建分组', enabled ? '新建分组' : '只有手动分组模式可以新建分组');
  result.disabled = !enabled;
  result.addEventListener('click', () => {
    if (!enabled) return;
    vscode.postMessage({ type: 'requestCreateGroup' });
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

function markActiveTab(target: TabTarget): void {
  if (!latestSnapshot) return;
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.tab-row.is-active'))) {
    row.classList.remove('is-active');
  }
  const row = Array.from(document.querySelectorAll<HTMLElement>('.tab-row')).find((candidate) => {
    const candidateTarget = parseTargetDataset(candidate.dataset.target);
    return candidateTarget !== undefined && sameTarget(candidateTarget, target);
  });
  row?.classList.add('is-active');
}

function parseTargetDataset(value: string | undefined): TabTarget | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as TabTarget;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function dismissContextMenu(): void {
  contextMenu?.remove();
  contextMenu = undefined;
}

type _GroupModeCheck = GroupMode;
type _SortModeCheck = SortMode;
