import type { ExtensionMessage, GroupMode, SortMode, TabTarget, TabTargetIdentity, VerticalTabDisplayGroup, VerticalTabItem } from './messages';
import { TabSelection } from './TabSelection';
 import { dragInsertionEdge, type DragInsertionEdge } from './dragInsertion';
 import { canMoveFilesBetweenDirectories, canReorderTabs, tabDragCapability } from './dragPolicy';

 declare var __i18n: Record<string, string> | undefined;

declare const acquireVsCodeApi: () => { getState(): WebviewState | undefined; postMessage(message: unknown): void; setState(state: WebviewState): void };

interface WebviewState {
  readonly collapsedGroups?: readonly string[];
}

interface DragImageOffset {
  readonly x: number;
  readonly y: number;
}

const vscode = acquireVsCodeApi();
const description = document.querySelector<HTMLParagraphElement>('#description');
const groups = document.querySelector<HTMLElement>('#groups');
const verticalTabs = document.querySelector<HTMLElement>('.vertical-tabs');
const toolbarControls = document.querySelector<HTMLElement>('#toolbar-controls');
const toggleToolbarControlsButton = document.querySelector<HTMLButtonElement>('#toggle-toolbar-controls');
const expandAllButton = document.querySelector<HTMLButtonElement>('#expand-all');
const collapseAllButton = document.querySelector<HTMLButtonElement>('#collapse-all');
const groupModeSelect = document.querySelector<HTMLSelectElement>('#group-mode');
const searchContainer = document.querySelector<HTMLElement>('#search-container');
const searchInput = document.querySelector<HTMLInputElement>('#search-input');
const searchGroupToggle = document.querySelector<HTMLButtonElement>('#search-group-toggle');
const toggleSearchButton = document.querySelector<HTMLButtonElement>('#toggle-search');
const sortModeSelect = document.querySelector<HTMLSelectElement>('#sort-mode');
const collapsedGroups = new Set(vscode.getState()?.collapsedGroups ?? []);
let contextMenu: HTMLElement | undefined;
let latestSnapshot: Extract<ExtensionMessage, { type: 'renderTabs' }>['snapshot'] | undefined;
let currentSearchQuery = '';
let currentSearchGroups = false;
let draggedTarget: TabTarget | undefined;
let draggedTargets: readonly TabTarget[] = [];
let draggedGroupId: string | undefined;
let dropIndicator: HTMLElement | undefined;
let dropHighlightedGroup: HTMLElement | undefined;

const EN_DEFAULTS: Record<string, string> = {
  emptyState: 'No displayable editor tabs.', expand: 'Expand', collapse: 'Collapse',
  expandGroup: 'Expand group', collapseGroup: 'Collapse group', pinnedGroup: 'Pinned group',
  closeGroupAndDelete: 'Close all tabs in group and delete group', closeTab: 'Close tab', close: 'Close',
  closeOthers: 'Close others', closeBelow: 'Close below', closeGroup: 'Close all tabs in group',
  closeSaved: 'Close saved', closeAll: 'Close all', closeSavedTabs: 'Close saved tabs in group',
  closeAllUnpinned: 'Close all unpinned tabs in group', pinTab: 'Pin tab', unpinTab: 'Unpin tab',
  pinGroup: 'Pin group', unpinGroup: 'Unpin group', cannotPinVscodeGroup: 'Cannot pin group when following VS Code groups',
  rename: 'Rename', renameGroup: 'Rename group', groupName: 'Group name',
  newGroup: 'New group', newGroupOnlyManual: 'Only manual grouping mode can create groups',
  previewSuffix: ' (preview)', bestEffortActivation: 'Navigate using VS Code built-in commands',
  unsupportedActivation: 'Cannot be navigated by extension',
  hideToolbarControls: 'Hide grouping and sorting controls', showToolbarControls: 'Show grouping and sorting controls',
  searchPlaceholder: 'Search', searchGroup: 'Search group names',
  showSearch: 'Show search', hideSearch: 'Hide search',
  ungrouped: 'Ungrouped', other: 'Other', workspaceRoot: 'Workspace root',
  noExtension: 'No extension', editorGroup: 'Editor Group {0}',
};

function resolveI18n(): Record<string, string> {
  if (typeof __i18n !== 'undefined') {
    return __i18n;
  }
  return {};
}

const i18n = new Proxy(resolveI18n(), {
  get(target: Record<string, string>, prop: string) {
    return target[prop] ?? EN_DEFAULTS[prop] ?? prop;
  }
}) as Record<string, string>;


let refreshAttempts = 0;
let activateRequestSequence = 0;
let dragRequestSequence = 0;
let pendingActivateTarget: TabTarget | undefined;
let pendingActivateTimestamp = 0;
const selection = new TabSelection();

window.addEventListener('error', (event) => logToExtension('error', '脚本运行错误', `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`));
window.addEventListener('unhandledrejection', (event) => logToExtension('error', '脚本 Promise 未处理异常', stringifyDetails(event.reason)));
window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
  if (event.data.type === 'renderTabs') {
    logToExtension('debug', '收到标签渲染消息', `revision=${event.data.snapshot.revision}, tabs=${event.data.snapshot.tabs.length}`);
    render(event.data);
  }
});
verticalTabs?.addEventListener('contextmenu', (event) => { event.preventDefault(); showContextMenu(event.clientX, event.clientY); });
toggleToolbarControlsButton?.addEventListener('click', () => {
  const visible = toolbarControls?.hidden ?? false;
  setToolbarControlsVisible(visible);
  vscode.postMessage({ type: 'setToolbarControlsVisible', visible });
});
expandAllButton?.addEventListener('click', () => setAllGroupsCollapsed(false));
collapseAllButton?.addEventListener('click', () => setAllGroupsCollapsed(true));
groupModeSelect?.addEventListener('change', () => {
  vscode.postMessage({ type: 'setGroupMode', groupMode: groupModeSelect.value as GroupMode });
});
sortModeSelect?.addEventListener('change', () => {
  vscode.postMessage({ type: 'setSortMode', sortMode: sortModeSelect.value as SortMode });
});

toggleSearchButton?.addEventListener('click', () => {
  const visible = !(latestSnapshot?.searchVisible ?? true);
  vscode.postMessage({ type: 'setSearchVisible', visible });
  setSearchContainerVisible(visible);
});

searchGroupToggle?.addEventListener('click', () => {
  currentSearchGroups = !currentSearchGroups;
  searchGroupToggle?.classList.toggle('is-active', currentSearchGroups);
  vscode.postMessage({ type: 'setSearchGroups', enabled: currentSearchGroups });
  applyCurrentFilter();
});

searchInput?.addEventListener('input', () => {
  currentSearchQuery = searchInput?.value ?? '';
  applyCurrentFilter();
});

document.addEventListener('click', () => dismissContextMenu());
document.addEventListener('dragend', () => { clearDropIndicator(); draggedGroupId = undefined; });
document.addEventListener('drop', () => clearDropIndicator());
document.addEventListener('dragleave', (event) => { if (event.relatedTarget === null) clearDropIndicator(); });
document.addEventListener('dragover', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('.tab-group')) clearDropIndicator();
});
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
  clearDropIndicator();
  if (!message.snapshot.rememberState && collapsedGroups.size > 0) {
    collapsedGroups.clear();
    vscode.setState({});
  }
  pruneSelectedTabs(message.snapshot.tabs);
  if (groupModeSelect) groupModeSelect.value = message.snapshot.groupMode;
  if (sortModeSelect) sortModeSelect.value = message.snapshot.sortMode;
  setToolbarControlsVisible(message.snapshot.toolbarControlsVisible);
  setSearchContainerVisible(message.snapshot.searchVisible);
  currentSearchGroups = message.snapshot.searchGroups;
  searchGroupToggle?.classList.toggle('is-active', message.snapshot.searchGroups);
  groups.replaceChildren();
  const { tabs, displayGroups } = message.snapshot;
  description.textContent = tabs.length === 0 ? i18n.emptyState : '';
  const filteredGroups = applySearchFilter(displayGroups, currentSearchQuery, currentSearchGroups);
  for (const group of filteredGroups) appendDisplayGroup(groups, group);
  updateTreeActionState();
  correctPendingActivation();
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
  section.className = [
    'tab-group',
    group.showHeader ? 'with-header' : 'without-header',
    isEmptyManualRootGroup(group) ? 'empty-manual-root' : '',
    group.isPinned ? 'is-pinned-group' : '',
    collapsed ? 'is-collapsed' : '',
  ].filter(Boolean).join(' ');
  section.dataset.groupId = group.id;
  section.addEventListener('dragover', (event) => handleGroupDragOver(event, group));
  section.addEventListener('drop', (event) => handleGroupDrop(event, group));
  if (group.showHeader) {
    const header = document.createElement('header');
    header.className = 'group-header';
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', String(!collapsed));
    header.title = collapsed ? i18n.expandGroup : i18n.collapseGroup;
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
    if (group.isManual && group.id !== '__ungrouped') {
      header.draggable = true;
      header.addEventListener('dragstart', (event) => {
        draggedGroupId = group.id;
        event.dataTransfer?.setData('application/x-vertical-tab-group-id', group.id);
        event.dataTransfer!.effectAllowed = 'move';
      });
    }
    const main = document.createElement('div');
    main.className = 'group-main';
    const toggle = button(collapsed ? '▶' : '▼', collapsed ? i18n.expandGroup : i18n.collapseGroup);
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
    if (group.isPinned) {
      const pin = document.createElement('span');
      pin.className = 'group-pin-indicator';
      pin.textContent = '📌';
      pin.title = i18n.pinnedGroup;
      pin.setAttribute('aria-label', i18n.pinnedGroup);
      main.append(pin);
    }
    if (group.description) {
      const detail = document.createElement('span');
      detail.className = 'group-description';
      detail.textContent = group.description;
      main.append(detail);
    }
    header.append(main);
    const actions = document.createElement('div');
    actions.className = 'group-actions';
    const remove = button('×', i18n.closeGroupAndDelete);
    remove.className = 'group-action tab-action';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: 'closeGroup', groupId: group.id });
    });
    actions.append(remove);
    header.append(actions);
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
  const selected = isSelected(tab);
  const multiSelected = selected && selection.keys().length > 1;
  row.className = ['tab-row', `tree-level-${level}`, selected ? 'is-selected' : '', multiSelected ? 'is-multi-selected' : '', tab.isActive ? 'is-active' : '', tab.isFocused ? 'is-focused' : '', tab.isDirty ? 'is-dirty' : '', tab.isPinned ? 'is-pinned' : '', tab.isActivatable ? '' : 'is-unavailable'].filter(Boolean).join(' ');
  row.draggable = currentDragCapability() !== 'disabled';
  row.dataset.groupId = group.id;
  row.dataset.target = JSON.stringify(tab.target);
  let dragImageOffset: DragImageOffset | undefined;
  let preserveMultiSelectionOnPointerDown = false;
  let draggedAfterPreservePointerDown = false;
  row.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragImageOffset = dragImageOffsetWithin(row, event.clientX, event.clientY);
  }, { capture: true });
  row.addEventListener('dragstart', (event) => {
    if (preserveMultiSelectionOnPointerDown) draggedAfterPreservePointerDown = true;
    draggedTarget = tab.target;
    draggedTargets = selectedTargetsFor(tab);
    const requestId = nextDragRequestId();
    const hotspot = dragImageOffset ?? dragImageOffsetWithin(row, event.clientX, event.clientY);
    row.dataset.dragRequestId = requestId;
    logToExtension('debug', '标签拖拽开始', targetDetails(tab.target, tab.label, requestId));

    event.dataTransfer?.setData('application/x-vertical-tab-target', JSON.stringify(tab.target));
    event.dataTransfer?.setData('application/x-vertical-tab-drag-request', requestId);
    event.dataTransfer?.setData('text/plain', tab.label);
    event.dataTransfer?.setDragImage(row, hotspot.x, hotspot.y);
  });
  row.addEventListener('dragend', (event) => {
    logToExtension('debug', '标签拖拽结束', targetDetails(tab.target, tab.label, row.dataset.dragRequestId));
    const dropEff = event.dataTransfer?.dropEffect ?? 'none';
    const cancelledPreservedDrag = preserveMultiSelectionOnPointerDown
      && draggedAfterPreservePointerDown
      && dropEff === 'none';
    logToExtension('debug', 'MULTI_CLICK_DEBUG dragend', JSON.stringify({ label: tab.label, preserve: preserveMultiSelectionOnPointerDown, draggedAfter: draggedAfterPreservePointerDown, dropEffect: dropEff, cancelled: cancelledPreservedDrag }));
    draggedTarget = undefined;
    draggedTargets = [];
    dragImageOffset = undefined;
    delete row.dataset.dragRequestId;
    if (cancelledPreservedDrag) {
      logToExtension("debug", "MULTI_CLICK_DEBUG dragend -> cancelled, calling collapsePreservedMultiSelection");
      // Chromium suppresses click (and may omit pointerup on the button) once a
      // tiny pointer movement starts native dragging. If that drag was never
      // dropped, treat the gesture as the original click instead of leaving a
      // stale multi-selection and inactive target behind.
      draggedAfterPreservePointerDown = false;
      collapsePreservedMultiSelection();
    } else if (preserveMultiSelectionOnPointerDown) {
      logToExtension("debug", "MULTI_CLICK_DEBUG dragend -> preserve branch, calling selectSingle+requestActivation");
      preserveMultiSelectionOnPointerDown = false;
      draggedAfterPreservePointerDown = false;
      const currentTab = findCurrentTabByIdentity(tab.target.identity);
      if (currentTab) {
        logToExtension("debug", "MULTI_CLICK_DEBUG dragend using snapshot tab", targetDetails(currentTab.target, currentTab.label));
        selectSingle(currentTab);
        requestActivation(currentTab.target);
      } else {
        logToExtension("debug", "MULTI_CLICK_DEBUG dragend fallback to closure tab", targetDetails(tab.target, tab.label));
        selectSingle(tab);
        requestActivation();
      }
    }
    event.preventDefault();
  });
  row.addEventListener('dragover', (event) => handleTabDragOver(event, row, tab, group));
  row.addEventListener('drop', (event) => handleTabDrop(event, row, tab, group));
  const activate = document.createElement('button');
  activate.className = 'tab-main';
  activate.type = 'button';
  activate.disabled = !tab.isActivatable;
 activate.title = activationTitle(tab);
  const requestActivation = (targetOverride?: TabTarget) => {
    const target = targetOverride ?? tab.target;
    const requestId = nextActivateRequestId();
    logToExtension('debug', '标签激活按钮发送单次激活请求', targetDetails(target, tab.label, requestId));
    markActiveTab(target);
    vscode.postMessage({ type: 'activateTab', target, requestId });
  };
  const collapsePreservedMultiSelection = () => {
    if (!preserveMultiSelectionOnPointerDown || draggedAfterPreservePointerDown) { logToExtension("debug", "MULTI_CLICK_DEBUG collapsePreservedMultiSelection early return", JSON.stringify({ label: tab.label, preserve: preserveMultiSelectionOnPointerDown, draggedAfter: draggedAfterPreservePointerDown })); return; }
    logToExtension("debug", "MULTI_CLICK_DEBUG collapsePreservedMultiSelection executing", targetDetails(tab.target, tab.label));
    preserveMultiSelectionOnPointerDown = false;
    const currentTab = findCurrentTabByIdentity(tab.target.identity);
    if (currentTab) {
      logToExtension("debug", "MULTI_CLICK_DEBUG collapsePreservedMultiSelection using snapshot tab", targetDetails(currentTab.target, currentTab.label));
      selectSingle(currentTab);
      requestActivation(currentTab.target);
    } else {
      logToExtension("debug", "MULTI_CLICK_DEBUG collapsePreservedMultiSelection fallback to closure tab", targetDetails(tab.target, tab.label));
      selectSingle(tab);
      requestActivation();
    }
  };
  activate.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // A drag does not always produce a click, so a previous gesture may have
    // left this flag set. Every new pointer gesture must decide preservation
    // from its own current selection state.
    preserveMultiSelectionOnPointerDown = false;
    draggedAfterPreservePointerDown = false;
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      updateSelection(tab, { shiftKey: event.shiftKey, toggleKey: event.ctrlKey || event.metaKey });
      return;
    }
    if (isSelected(tab) && selectedTabsFor(tab).length > 1) {
      // Keep the selected block intact until we know this is a click rather
      // than the beginning of a drag. Dragstart then carries every selected
      // target; an ordinary click collapses to one item below.
      logToExtension("debug", "MULTI_CLICK_DEBUG pointerdown -> preserve branch, calling setPointerCapture", targetDetails(tab.target, tab.label));
      preserveMultiSelectionOnPointerDown = true;
      // Keep pointerup routed to this button when the pointer drifts a few
      // pixels outside it. Without capture neither pointerup nor click is
      // guaranteed, so the preserved multi-selection can otherwise get stuck.
      activate.setPointerCapture(event.pointerId);
      return;
    }
    selectSingle(tab);
    requestActivation();
  });
  activate.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    logToExtension('debug', 'MULTI_CLICK_DEBUG pointerup fired', JSON.stringify({ label: tab.label, preserve: preserveMultiSelectionOnPointerDown, draggedAfter: draggedAfterPreservePointerDown }));
    if (preserveMultiSelectionOnPointerDown && !draggedAfterPreservePointerDown) {
      collapsePreservedMultiSelection();
    }
  });
  activate.addEventListener('click', (event) => {
    logToExtension('debug', 'MULTI_CLICK_DEBUG click fired', JSON.stringify({ label: tab.label, detail: event.detail, preserve: preserveMultiSelectionOnPointerDown, draggedAfter: draggedAfterPreservePointerDown }));
    // Most mouse and pen activation is handled on pointerdown. A click on an
    // existing multi-selection is intentionally deferred so dragstart can
    // still carry the whole block; keyboard-generated clicks use detail=0.
    if (event.detail === 0) {
      selectSingle(tab);
      requestActivation();
    } else if (preserveMultiSelectionOnPointerDown) {
      collapsePreservedMultiSelection();
    }
  });
  const pin = document.createElement('span');
  pin.className = 'tab-pin-slot';
  pin.textContent = tab.isPinned ? '📌' : '';
  pin.setAttribute('aria-hidden', 'true');
  activate.append(pin);
  const copy = document.createElement('span');
  copy.className = 'tab-copy';
  const label = document.createElement('span');
  label.className = 'tab-label';
  label.textContent = `${tab.isDirty ? '● ' : ''}${tab.label}${tab.isPreview ? i18n.previewSuffix : ''}`;
  activate.addEventListener("lostpointercapture", () => {
    logToExtension("debug", "MULTI_CLICK_DEBUG lostpointercapture", JSON.stringify({ label: tab.label, preserve: preserveMultiSelectionOnPointerDown }));
    if (preserveMultiSelectionOnPointerDown) {
      logToExtension("debug", "MULTI_CLICK_DEBUG lostpointercapture -> activating");
      preserveMultiSelectionOnPointerDown = false;
      draggedAfterPreservePointerDown = false;
      const currentTab = findCurrentTabByIdentity(tab.target.identity);
      if (currentTab) {
        selectSingle(currentTab);
        requestActivation(currentTab.target);
      } else {
        logToExtension("debug", "MULTI_CLICK_DEBUG lostpointercapture fallback to closure tab", targetDetails(tab.target, tab.label));
        selectSingle(tab);
        requestActivation();
      }
    }
  });
  copy.append(label);
  if (tab.description) {
    const detail = document.createElement('span');
    detail.className = 'tab-description';
    detail.textContent = tab.description;
    copy.append(detail);
  }
  activate.append(copy);
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isSelected(tab)) selectSingle(tab);
    showContextMenu(event.clientX, event.clientY, tab);
  });
  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  actions.append(closeSelectionButton(tab));
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

function isEmptyManualRootGroup(group: VerticalTabDisplayGroup): boolean {
  return group.mode === 'manual' && group.id === '__ungrouped' && group.tabs.length === 0;
}

function groupCollapseKey(group: VerticalTabDisplayGroup): string {
  return `${group.mode}:${group.id}:closed`;
}

function openGroupCollapseKey(group: VerticalTabDisplayGroup): string {
  return `${group.mode}:${group.id}:open`;
}

function saveCollapsedGroups(): void {
  if (latestSnapshot?.rememberState) vscode.setState({ collapsedGroups: Array.from(collapsedGroups) });
  else vscode.setState({});
}

function updateTreeActionState(): void {
  const groupsWithHeaders = latestSnapshot?.displayGroups.filter((group) => group.showHeader) ?? [];
  const hasGroups = groupsWithHeaders.length > 0;
  if (expandAllButton) expandAllButton.disabled = !hasGroups;
  if (collapseAllButton) collapseAllButton.disabled = !hasGroups;
}

function setToolbarControlsVisible(visible: boolean): void {
  if (toolbarControls) toolbarControls.hidden = !visible;
  if (toggleToolbarControlsButton) {
    toggleToolbarControlsButton.title = visible ? i18n.hideToolbarControls : i18n.showToolbarControls;
    toggleToolbarControlsButton.setAttribute('aria-label', toggleToolbarControlsButton.title);
    toggleToolbarControlsButton.setAttribute('aria-pressed', String(!visible));
  }
}

function activationTitle(tab: VerticalTabItem): string {
  const title = tab.tooltipPath ?? tab.label;
  if (tab.activationKind === 'reliable') return title;
  if (tab.activationKind === 'bestEffort') return `${title}：使用 VS Code 内置导航命令尝试跳转`;
  return `${title} 无法由扩展跳转`;
}

function dragImageOffsetWithin(row: HTMLElement, clientX: number, clientY: number): DragImageOffset {
  const bounds = row.getBoundingClientRect();
  return {
    x: clamp(clientX - bounds.left, 0, bounds.width),
    y: clamp(clientY - bounds.top, 0, bounds.height),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function handleGroupDragOver(event: DragEvent, group: VerticalTabDisplayGroup): void {
  if (draggedGroupId) {
    if (draggedGroupId === group.id) { clearDropIndicator(); return; }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    const section = event.currentTarget as HTMLElement;
    const rect = section.getBoundingClientRect();
    const edge = dragInsertionEdge(event.clientY, rect.top, rect.height);
    const displayGroups = latestSnapshot?.displayGroups ?? [];
    if (edge === 'after') {
      const groupIndex = displayGroups.findIndex((g) => g.id === group.id);
      const nextGroup = displayGroups.slice(groupIndex + 1).find((g) => g.showHeader && g.isManual && g.id !== '__ungrouped');
      const nextSection = nextGroup ? section.parentElement?.querySelector<HTMLElement>(`.tab-group[data-group-id="${nextGroup.id}"]`) : undefined;
      if (nextSection) {
        const nextRect = nextSection.getBoundingClientRect();
        showDropIndicator(Math.max(rect.left, nextRect.left), nextRect.top, Math.max(rect.width, nextRect.width));
      } else {
        const lastChild = section.parentElement?.lastElementChild as HTMLElement;
        if (lastChild) {
          const lastRect = lastChild.getBoundingClientRect();
          showDropIndicator(lastRect.left, lastRect.bottom, lastRect.width);
        }
      }
    } else {
      showDropIndicator(rect.left, rect.top, rect.width);
    }
    return;
  }
  if (!draggedTarget || currentDragCapability() === 'disabled' || targetsForDrop(group).length === 0) {
    clearDropIndicator();
    return;
  }
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
  showGroupDropHighlight(event.currentTarget as HTMLElement);
}

function handleGroupDrop(event: DragEvent, group: VerticalTabDisplayGroup): void {
  clearDropIndicator();
  if (draggedGroupId) {
    if (draggedGroupId === group.id) return;
    event.preventDefault();
    const displayGroups = latestSnapshot?.displayGroups ?? [];
    const targetIndex = displayGroups.findIndex((g) => g.id === group.id);
    let beforeGroupId: string | undefined;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (dragInsertionEdge(event.clientY, rect.top, rect.height) === 'after') {
      const afterMatch = displayGroups.slice(targetIndex + 1).find((g) => g.showHeader && g.isManual && g.id !== '__ungrouped');
      beforeGroupId = afterMatch?.id;
    } else {
      if (group.isManual && group.id !== '__ungrouped') {
        beforeGroupId = group.id;
      } else {
        beforeGroupId = displayGroups.find((g) => g.showHeader && g.isManual && g.id !== '__ungrouped')?.id;
      }
    }
    logToExtension('debug', '分组拖拽排序请求', `groupId=${draggedGroupId}, beforeGroupId=${beforeGroupId ?? 'none'}`);
    vscode.postMessage({ type: 'reorderManualGroup', groupId: draggedGroupId, ...(beforeGroupId ? { beforeGroupId } : {}) });
    draggedGroupId = undefined;
    return;
  }
  if (!draggedTarget || currentDragCapability() === 'disabled') return;
  event.preventDefault();
  const targets = targetsForDrop(group);
  if (targets.length === 0) return;
  const groupId = group.mode === 'manual' && group.id === '__ungrouped' ? undefined : group.id;
  logToExtension('debug', '标签拖拽投放到分组', dropDetails(event, draggedTarget, group.id));
  postTabMove(targets, groupId);
}

function handleTabDragOver(event: DragEvent, row: HTMLElement, tab: VerticalTabItem, group: VerticalTabDisplayGroup): void {
  const capability = currentDragCapability();
  if (!draggedTarget || capability === 'disabled' || targetsForDrop(group).length === 0) {
    clearDropIndicator();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer!.dropEffect = 'move';
  if (capability === 'moveGroup' || capability === 'moveDirectory') {
    showGroupDropHighlight(row.closest<HTMLElement>('.tab-group') ?? row);
    return;
  }
  if (draggedTargets.some((target) => sameTarget(target, tab.target))) {
    clearDropIndicator();
    return;
  }
  showTabDropIndicator(row, dragInsertionEdge(event.clientY, row.getBoundingClientRect().top, row.getBoundingClientRect().height));
}

function handleTabDrop(event: DragEvent, row: HTMLElement, tab: VerticalTabItem, group: VerticalTabDisplayGroup): void {
  clearDropIndicator();
  const capability = currentDragCapability();
  if (!draggedTarget || capability === 'disabled') return;
  event.preventDefault();
  // The tab row lives inside the group drop zone. Without stopping this event,
  // one gesture emits both a positioned move and a second append-to-group move,
  // so the latter can overwrite the requested position and send the tab to the end.
  event.stopPropagation();
  const targets = targetsForDrop(group);
  if (targets.length === 0 || targets.some((target) => sameTarget(target, tab.target))) return;
  const groupId = group.mode === 'manual' && group.id === '__ungrouped' ? undefined : group.id;
  const beforeTarget = canReorderTabs(capability) ? beforeTargetForDrop(event, row, tab, group) : undefined;
  logToExtension('debug', canReorderTabs(capability) ? '标签拖拽排序请求' : '标签拖拽改分组请求', dropDetails(event, draggedTarget, group.id, beforeTarget));
  postTabMove(targets, groupId, beforeTarget);
}

function beforeTargetForDrop(event: DragEvent, row: HTMLElement, tab: VerticalTabItem, group: VerticalTabDisplayGroup): TabTarget | undefined {
  const bounds = row.getBoundingClientRect();
  if (dragInsertionEdge(event.clientY, bounds.top, bounds.height) === 'before') return tab.target;
  const tabIndex = group.tabs.findIndex((candidate) => sameTarget(candidate.target, tab.target));
  return group.tabs.slice(tabIndex + 1).find((candidate) =>
    !draggedTargets.some((target) => sameTarget(target, candidate.target)))?.target;
}

function showTabDropIndicator(row: HTMLElement, edge: DragInsertionEdge): void {
  clearGroupDropHighlight();
  const bounds = row.getBoundingClientRect();
  showDropIndicator(bounds.left, edge === 'before' ? bounds.top : bounds.bottom, bounds.width);
}

function showGroupDropHighlight(group: HTMLElement): void {
  if (dropIndicator) dropIndicator.hidden = true;
  if (dropHighlightedGroup === group) return;
  clearGroupDropHighlight();
  dropHighlightedGroup = group;
  dropHighlightedGroup.classList.add('is-drop-target');
}

function showDropIndicator(left: number, top: number, width: number): void {
  if (!dropIndicator) {
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'tab-drop-indicator';
    dropIndicator.setAttribute('aria-hidden', 'true');
    document.body.append(dropIndicator);
  }
  dropIndicator.style.left = `${Math.round(left)}px`;
  dropIndicator.style.top = `${Math.round(top)}px`;
  dropIndicator.style.width = `${Math.max(0, Math.round(width))}px`;
  dropIndicator.hidden = false;
}

function clearDropIndicator(): void {
  if (dropIndicator) dropIndicator.hidden = true;
  clearGroupDropHighlight();
}

function clearGroupDropHighlight(): void {
  if (!dropHighlightedGroup) return;
  dropHighlightedGroup.classList.remove('is-drop-target');
  dropHighlightedGroup = undefined;
}

function currentDragCapability(): ReturnType<typeof tabDragCapability> {
  return latestSnapshot ? tabDragCapability(latestSnapshot.groupMode, latestSnapshot.sortMode) : 'disabled';
}

function targetsForDrop(group: VerticalTabDisplayGroup): readonly TabTarget[] {
  const capability = currentDragCapability();
  const dragOrigin = draggedTarget;
  const dragOriginIsInGroup = dragOrigin !== undefined && group.tabs.some((tab) => sameTarget(tab.target, dragOrigin));
  if (group.mode === 'fileType' && capability === 'reorder') {
    // File-type groups describe an extension; a cross-group drop must never be
    // treated as an implicit rename that changes the file extension.
    return dragOriginIsInGroup
      ? draggedTargets.filter((target) => group.tabs.some((tab) => sameTarget(tab.target, target)))
      : [];
  }
  if (canMoveFilesBetweenDirectories(capability)) {
    // In a parent-directory group, a drop inside the source group is a native
    // tab reorder. A drop on another group moves only files not already there.
    return dragOriginIsInGroup && canReorderTabs(capability)
      ? draggedTargets.filter((target) => group.tabs.some((tab) => sameTarget(tab.target, target)))
      : draggedTargets.filter((target) => !group.tabs.some((tab) => sameTarget(tab.target, target)));
  }
  if (capability === 'reorder') return draggedTargets;
  return draggedTargets.filter((target) => !group.tabs.some((tab) => sameTarget(tab.target, target)));
}

function postTabMove(targets: readonly TabTarget[], groupId: string | undefined, beforeTarget?: TabTarget): void {
  if (targets.length === 1) {
    vscode.postMessage({ type: 'moveTab', target: targets[0], groupId, ...(beforeTarget ? { beforeTarget } : {}) });
    return;
  }
  vscode.postMessage({ type: 'moveTabs', targets, groupId, ...(beforeTarget ? { beforeTarget } : {}) });
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

function closeSelectionButton(tab: VerticalTabItem): HTMLButtonElement {
  const result = button('×', i18n.closeTab);
  result.className = 'tab-action';
  result.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
  });

  result.addEventListener('click', (event) => {
    event.stopPropagation();
    const targets = selectedTargetsFor(tab);
    vscode.postMessage(targets.length > 1 ? { type: 'closeTabs', targets } : { type: 'closeTab', target: tab.target });
  });
  return result;
}

function postTarget(type: 'activateTab' | 'closeTab' | 'closeOthers' | 'closeBelow', target: TabTarget): void { vscode.postMessage({ type, target }); }

function isSelected(tab: VerticalTabItem): boolean {
  return selection.isSelected(tab);
}

function selectSingle(tab: VerticalTabItem): void {
  selection.selectSingle(tab);
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.tab-row.is-selected, .tab-row.is-multi-selected'))) {
    row.classList.remove('is-selected', 'is-multi-selected');
  }
  findTabRow(tab.target)?.classList.add('is-selected');
}

function updateSelection(tab: VerticalTabItem, keys: { readonly shiftKey: boolean; readonly toggleKey: boolean }): void {
  selection.update(selectableTabs(), tab, keys);
  if (latestSnapshot) render({ type: 'renderTabs', title: 'Vertical Tabs', snapshot: latestSnapshot });
}

function selectedTargetsFor(tab: VerticalTabItem): readonly TabTarget[] {
  return selectedTabsFor(tab).map((candidate) => candidate.target);
}

function selectedTabsFor(tab: VerticalTabItem): readonly VerticalTabItem[] {
  if (!latestSnapshot) return [tab];
  return selection.selectedTabs(latestSnapshot.displayGroups.flatMap((group) => group.tabs), tab);
}

function pruneSelectedTabs(tabs: readonly VerticalTabItem[]): void {
  selection.prune(tabs);
}

function selectableTabs(): readonly VerticalTabItem[] {
  return latestSnapshot?.displayGroups.flatMap((group) => isGroupCollapsed(group) ? [] : group.tabs) ?? [];
}

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
  if (group) {
    menu.append(
      messageButton(i18n.close, i18n.closeGroup, { type: 'closeGroup', groupId: group.id }),
      groupPinButton(group),
    );
  }
  if (tab) {
    const targets = selectedTargetsFor(tab);
    const multi = targets.length > 1;
    const pinned = multi ? selectedTabsFor(tab).every((candidate) => candidate.isPinned) : tab.isPinned;
    menu.append(
      multi ? messageButton(i18n.close, i18n.closeTab, { type: 'closeTabs', targets }) : actionButton(i18n.close, i18n.closeTab, 'closeTab', tab.target, true),
      multi ? messageButton(i18n.closeOthers, i18n.closeOthers, { type: 'closeOthersForTabs', targets }) : actionButton(i18n.closeOthers, i18n.closeOthers, 'closeOthers', tab.target, true),
      multi ? messageButton(i18n.closeBelow, i18n.closeBelow, { type: 'closeBelowForTabs', targets }) : actionButton(i18n.closeBelow, i18n.closeBelow, 'closeBelow', tab.target, true),
      messageButton(pinned ? i18n.unpinTab : i18n.pinTab, pinned ? i18n.unpinTab : i18n.pinTab, multi ? { type: pinned ? 'unpinTabs' : 'pinTabs', targets } : { type: pinned ? 'unpinTab' : 'pinTab', target: tab.target }),
    );
  }
  const snapshot = latestSnapshot;
  menu.append(
    createGroupButton(snapshot?.groupMode === 'manual'),
    groupActionButton(i18n.closeSaved, i18n.closeSavedTabs, 'closeSaved'),
    groupActionButton(i18n.closeAll, i18n.closeAllUnpinned, 'closeAll'),
  );
  menu.querySelectorAll('button').forEach((item) => item.classList.add('tab-context-action'));
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4))}px`;
  contextMenu = menu;
}

function renameGroupButton(group: VerticalTabDisplayGroup): HTMLButtonElement {
  const result = button(i18n.rename, i18n.renameGroup);
  result.addEventListener('click', () => {
    const value = window.prompt(i18n.groupName, group.title);
    if (value?.trim()) vscode.postMessage({ type: 'renameGroup', groupId: group.id, name: value.trim() });
    dismissContextMenu();
  });
  return result;
}

function groupPinButton(group: VerticalTabDisplayGroup): HTMLButtonElement {
  const disabled = group.mode === 'vscode';
  const result = messageButton(group.isPinned ? i18n.unpinGroup : i18n.pinGroup, disabled ? i18n.cannotPinVscodeGroup : group.isPinned ? i18n.unpinGroup : i18n.pinGroup, { type: group.isPinned ? 'unpinGroup' : 'pinGroup', groupId: group.id });
  result.disabled = Boolean(disabled);
  return result;
}

function groupActionButton(label: string, title: string, type: 'closeSaved' | 'closeAll'): HTMLButtonElement {
  return messageButton(label, title, { type });
}

function createGroupButton(enabled: boolean): HTMLButtonElement {
  const result = button(i18n.newGroup, enabled ? i18n.newGroup : i18n.newGroupOnlyManual);
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
  if (left.groupIndex === right.groupIndex && JSON.stringify(left.identity) === JSON.stringify(right.identity)) return true;
  return left.revision === right.revision && left.groupIndex === right.groupIndex && left.tabIndex === right.tabIndex;
}

function markActiveTab(target: TabTarget): void {
  if (!latestSnapshot) return;
  pendingActivateTarget = target;
  pendingActivateTimestamp = Date.now();
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.tab-row.is-focused'))) {
    row.classList.remove('is-focused');
  }
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.tab-row.is-active'))) {
    const candidateTarget = parseTargetDataset(row.dataset.target);
    if (candidateTarget?.groupIndex === target.groupIndex) row.classList.remove('is-active');
  }
  findTabRow(target)?.classList.add('is-active', 'is-focused');
}

function correctPendingActivation(): void {
  const PENDING_WINDOW_MS = 300;
  if (!pendingActivateTarget || Date.now() - pendingActivateTimestamp > PENDING_WINDOW_MS) {
    pendingActivateTarget = undefined;
    return;
  }
  const expectedRow = findTabRow(pendingActivateTarget);
  if (!expectedRow) {
    pendingActivateTarget = undefined;
    return;
  }
  if (expectedRow.classList.contains('is-active')) {
    pendingActivateTarget = undefined;
    return;
  }
  // A stale snapshot removed is-active from the user's intended target.
  // Restore it and remove is-active from whatever the snapshot picked.
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.tab-row.is-focused'))) {
    row.classList.remove('is-focused');
  }
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.tab-row.is-active'))) {
    const candidateTarget = parseTargetDataset(row.dataset.target);
    if (candidateTarget?.groupIndex === pendingActivateTarget.groupIndex) {
      row.classList.remove('is-active');
    }
  }
  expectedRow.classList.add('is-active', 'is-focused');
}

function findTabRow(target: TabTarget): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('.tab-row')).find((candidate) => {
    const candidateTarget = parseTargetDataset(candidate.dataset.target);
    return candidateTarget !== undefined && sameTarget(candidateTarget, target);
  });

}

function findCurrentTabByIdentity(identity: TabTargetIdentity): VerticalTabItem | undefined {
  return latestSnapshot?.displayGroups
    .flatMap(g => g.tabs)
    .find(t => JSON.stringify(t.target.identity) === JSON.stringify(identity));
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

function setSearchContainerVisible(visible: boolean): void {
  if (searchContainer) { searchContainer.hidden = !visible; }
  if (toggleSearchButton) { toggleSearchButton.title = visible ? i18n.hideSearch : i18n.showSearch; }
}

function applyCurrentFilter(): void {
  if (!latestSnapshot) return;
  render({ type: 'renderTabs', title: 'Vertical Tabs', snapshot: latestSnapshot });
}

function applySearchFilter(
  groups: readonly VerticalTabDisplayGroup[],
  query: string,
  searchGroups: boolean
): VerticalTabDisplayGroup[] {
  if (!query) return groups as VerticalTabDisplayGroup[];
  const lowerQuery = query.toLowerCase();
  const result: VerticalTabDisplayGroup[] = [];
  for (const group of groups) {
    const groupMatches = searchGroups && group.title.toLowerCase().includes(lowerQuery);
    if (groupMatches) { result.push(group); continue; }
    const matchingTabs = group.tabs.filter(tab => tab.label.toLowerCase().includes(lowerQuery));
    if (matchingTabs.length > 0) { result.push({ ...group, tabs: matchingTabs }); }
  }
  return result;
}
type _SortModeCheck = SortMode;
