import type { ExtensionMessage, GroupMode, NativeContextMenuEntry, SortMode, TabTarget, TabTargetIdentity, VerticalTabDisplayGroup, VerticalTabItem } from './messages';
import { DeferredTargetCommitter } from '../tabs/DeferredTargetCommitter';
import { ActiveTabFollowTracker } from './ActiveTabFollowTracker';
import { TabSelection } from './TabSelection';
import { dragInsertionEdge, type DragInsertionEdge } from './dragInsertion';
import { canMoveFilesBetweenDirectories, canReorderTabs, tabDragCapability } from './dragPolicy';
import { isKeyboardContextMenuKey, nextVerticalNavigationIndex, type VerticalNavigationKey } from './keyboardNavigation';
import { calculateScrollAnchorRestoration, isWithinNaturalScrollRange } from './scrollAnchor';
import {
  evaluateTabSearch,
  findTextMatchRanges,
  type TabSearchResult,
} from './searchFilter';

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
const worksetsButton = document.querySelector<HTMLButtonElement>('#worksets');
const expandAllButton = document.querySelector<HTMLButtonElement>('#expand-all');
const collapseAllButton = document.querySelector<HTMLButtonElement>('#collapse-all');
const groupModeSelect = document.querySelector<HTMLSelectElement>('#group-mode');
const searchContainer = document.querySelector<HTMLElement>('#search-container');
const searchInput = document.querySelector<HTMLInputElement>('#search-input');
const searchGroupToggle = document.querySelector<HTMLButtonElement>('#search-group-toggle');
const regexSearchToggle = document.querySelector<HTMLButtonElement>('#regex-search-toggle');
const searchWorkspaceRelativePathToggle = document.querySelector<HTMLButtonElement>('#search-workspace-relative-path-toggle');
const searchResultCount = document.querySelector<HTMLElement>('#search-result-count');
const searchError = document.querySelector<HTMLElement>('#search-error');
const toggleSearchButton = document.querySelector<HTMLButtonElement>('#toggle-search');
const sortModeSelect = document.querySelector<HTMLSelectElement>('#sort-mode');
const collapsedGroups = new Set(vscode.getState()?.collapsedGroups ?? []);
const searchCollapsedGroups = new Set<string>();
let contextMenu: HTMLElement | undefined;
let contextMenuInvoker: HTMLElement | undefined;
let pendingNativeMenuRequest: { readonly requestId: string; readonly target: TabTarget; readonly menu: HTMLElement; readonly x: number; readonly y: number } | undefined;
let latestSnapshot: Extract<ExtensionMessage, { type: 'renderTabs' }>['snapshot'] | undefined;
let currentSearchQuery = '';
let currentSearchGroups = false;
let currentUseRegex = false;
let currentSearchWorkspaceRelativePaths = false;
let latestSearchResult: TabSearchResult | undefined;
let draggedTarget: TabTarget | undefined;
let draggedTargets: readonly TabTarget[] = [];
let draggedGroupId: string | undefined;
let dropIndicator: HTMLElement | undefined;
let dropHighlightedGroup: HTMLElement | undefined;

const EN_DEFAULTS: Record<string, string> = {
  emptyState: 'No displayable editor tabs.', expand: 'Expand', collapse: 'Collapse',
  expandGroup: 'Expand group', collapseGroup: 'Collapse group', pinnedGroup: 'Pinned group',
  closeGroupAndDelete: 'Close all tabs in group and delete group', closeTab: 'Close tab', unsavedChanges: 'Unsaved changes', close: 'Close',
  closeOthers: 'Close others', closeBelow: 'Close below', closeGroup: 'Close all tabs in group',
  closeSaved: 'Close saved', closeAll: 'Close all', closeSavedTabs: 'Close saved tabs in group',
  closeAllUnpinned: 'Close all unpinned tabs in group', pinTab: 'Pin tab', unpinTab: 'Unpin tab',
  pinGroup: 'Pin group', unpinGroup: 'Unpin group', cannotPinVscodeGroup: 'Cannot pin group when following VS Code groups',
  rename: 'Rename', renameGroup: 'Rename group', groupName: 'Group name',
  newGroup: 'New group', newGroupOnlyManual: 'Only manual grouping mode can create groups',
  previewTab: 'Preview tab', pinnedTab: 'Pinned tab', readonlyResource: 'Read-only',
  resourceMissing: 'Resource is missing or deleted', resourceNoPermissions: 'No permission to access resource',
  resourceUnavailable: 'Resource file system is unavailable',
  bestEffortActivation: 'Navigate using VS Code built-in commands',
  unsupportedActivation: 'Cannot be navigated by extension',
  worksets: 'Worksets',
  hideToolbarControls: 'Hide grouping and sorting controls', showToolbarControls: 'Show grouping and sorting controls',
  searchPlaceholder: 'Search', searchGroup: 'Search group names',
  showSearch: 'Show search', hideSearch: 'Hide search',
  regexSearch: 'Use regular expression', invalidRegex: 'Invalid regular expression: {0}',
  searchWorkspaceRelativePaths: 'Search workspace-relative paths',
  searchResultCount: '{0} matching tabs', searchResultCountWithGroups: '{0} matching tabs · {1} matching groups',
  noSearchResults: 'No tabs match the current search.',
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

setAccessibleButtonLabel(expandAllButton, i18n.expand);
setAccessibleButtonLabel(collapseAllButton, i18n.collapse);
setAccessibleButtonLabel(worksetsButton, i18n.worksets);
setAccessibleButtonLabel(searchGroupToggle, i18n.searchGroup);
setAccessibleButtonLabel(regexSearchToggle, i18n.regexSearch);
setAccessibleButtonLabel(searchWorkspaceRelativePathToggle, i18n.searchWorkspaceRelativePaths);

let refreshAttempts = 0;
let activateRequestSequence = 0;
let dragRequestSequence = 0;
let nativeMenuRequestSequence = 0;
let pendingActivateTarget: TabTarget | undefined;
let pendingActivateTimestamp = 0;
let keyboardNavigationPreviewTarget: TabTarget | undefined;
let pendingTreeFocusRequest = false;
const selection = new TabSelection();
const activeTabFollowTracker = new ActiveTabFollowTracker();
const keyboardNavigationActivation = new DeferredTargetCommitter<TabTarget>(160, {
  onPreview: (target) => previewKeyboardNavigation(target),
  onClear: () => clearKeyboardNavigationPreview(),
  onCommit: async (target) => {
    const requestId = nextActivateRequestId();
    markActiveTab(target);
    vscode.postMessage({ type: 'activateTab', target, requestId, focus: 'rail' });
  },
  onError: (error) => logToExtension('error', '提交键盘标签导航失败', stringifyDetails(error)),
});

window.addEventListener('error', (event) => logToExtension('error', '脚本运行错误', `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`));
window.addEventListener('unhandledrejection', (event) => logToExtension('error', '脚本 Promise 未处理异常', stringifyDetails(event.reason)));
window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
  if (event.data.type === 'renderTabs') {
    logToExtension('debug', '收到标签渲染消息', `revision=${event.data.snapshot.revision}, tabs=${event.data.snapshot.tabs.length}`);
    render(event.data);
    return;
  }
  if (event.data.type === 'nativeTabMenu') {
    renderNativeContextMenu(event.data.requestId, event.data.entries);
    return;
  }
  if (event.data.type === 'previewTabNavigation') {
    previewKeyboardNavigation(event.data.target);
    return;
  }
  if (event.data.type === 'clearTabNavigationPreview') {
    clearKeyboardNavigationPreview();
    return;
  }
  if (event.data.type === 'focusTabList') {
    requestTreeFocus();
    return;
  }
  if (event.data.type === 'blurTabList') {
    cancelKeyboardNavigationActivation();
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.vertical-tabs')) {
      document.activeElement.blur();
    }
  }
});
verticalTabs?.addEventListener('contextmenu', (event) => { event.preventDefault(); showContextMenu(event.clientX, event.clientY); });
groups?.addEventListener('keydown', handleTreeKeyDown);
groups?.addEventListener('scroll', clearScrollAnchorCompensationWhenSafe, { passive: true });
groups?.addEventListener('focusin', (event) => {
  const item = treeItemFromEventTarget(event.target);
  if (item) setTreeTabStop(item);
});
toggleToolbarControlsButton?.addEventListener('click', () => {
  const visible = toolbarControls?.hidden ?? false;
  setToolbarControlsVisible(visible);
  vscode.postMessage({ type: 'setToolbarControlsVisible', visible });
});
worksetsButton?.addEventListener('click', () => {
  vscode.postMessage({ type: 'manageWorksets' });
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
  const visible = searchContainer?.hidden ?? false;
  if (!visible) clearSearch(false);
  vscode.postMessage({ type: 'setSearchVisible', visible });
  setSearchContainerVisible(visible);
  applyCurrentFilter();
  if (visible) searchInput?.focus();
});

searchGroupToggle?.addEventListener('click', () => {
  currentSearchGroups = !currentSearchGroups;
  updateSearchControlState();
  vscode.postMessage({ type: 'setSearchGroups', enabled: currentSearchGroups });
  applyCurrentFilter(true);
});

regexSearchToggle?.addEventListener('click', () => {
  currentUseRegex = !currentUseRegex;
  updateSearchControlState();
  applyCurrentFilter(true);
});

searchWorkspaceRelativePathToggle?.addEventListener('click', () => {
  currentSearchWorkspaceRelativePaths = !currentSearchWorkspaceRelativePaths;
  updateSearchControlState();
  applyCurrentFilter(true);
});

searchInput?.addEventListener('input', () => {
  currentSearchQuery = searchInput?.value ?? '';
  applyCurrentFilter(true);
});

searchInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  clearSearch();
});

document.addEventListener('click', () => dismissContextMenu());
document.addEventListener('pointerdown', () => cancelKeyboardNavigationActivation(), { capture: true });
document.addEventListener('dragend', () => { clearDropIndicator(); draggedGroupId = undefined; });
document.addEventListener('drop', () => clearDropIndicator());
document.addEventListener('dragleave', (event) => { if (event.relatedTarget === null) clearDropIndicator(); });
document.addEventListener('dragover', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('.tab-group')) clearDropIndicator();
});
window.addEventListener('blur', () => {
  dismissContextMenu();
  cancelKeyboardNavigationActivation();
  if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.vertical-tabs')) {
    document.activeElement.blur();
  }
});
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') dismissContextMenu(true); });
new ResizeObserver(([entry]) => { const width = Math.round(entry.contentRect.width); if (width >= 180) vscode.postMessage({ type: 'railWidth', width }); }).observe(document.documentElement);
logToExtension('debug', 'Webview 脚本已启动');
requestInitialSnapshot('ready');

function render(message: Extract<ExtensionMessage, { type: 'renderTabs' }>): void {
  if (!groups || !description) {
    logToExtension('error', '渲染标签失败：缺少必要 DOM 节点', `groups=${Boolean(groups)}, description=${Boolean(description)}`);
    return;
  }
  latestSnapshot = message.snapshot;
  if (message.snapshot.collapsedGroupKeys) {
    collapsedGroups.clear();
    for (const key of message.snapshot.collapsedGroupKeys) collapsedGroups.add(key);
    if (message.snapshot.rememberState) vscode.setState({ collapsedGroups: Array.from(collapsedGroups) });
  }
  clearDropIndicator();
  const followedTarget = prepareActiveTabFollow(message.snapshot);
  pruneSelectedTabs(message.snapshot.tabs);
  if (groupModeSelect) groupModeSelect.value = message.snapshot.groupMode;
  if (sortModeSelect) sortModeSelect.value = message.snapshot.sortMode;
  if (verticalTabs) verticalTabs.dataset.toolbarPosition = message.snapshot.toolbarPosition;
  setToolbarControlsVisible(message.snapshot.toolbarControlsVisible);
  setSearchContainerVisible(message.snapshot.searchVisible);
  currentSearchGroups = message.snapshot.searchGroups;
  updateSearchControlState();
  renderCurrentTabs({ preserveScroll: followedTarget === undefined });
  correctPendingActivation();
  revealFollowedTab(followedTarget);
  applyKeyboardNavigationPreview();
  applyPendingTreeFocusRequest();
  vscode.postMessage({ type: 'renderAck', revision: message.snapshot.revision });
  postSelectionChanged();
  logToExtension('debug', '标签渲染完成并发送确认', `revision=${message.snapshot.revision}, tabs=${message.snapshot.tabs.length}, groups=${message.snapshot.displayGroups.length}`);
}

function handleTreeKeyDown(event: KeyboardEvent): void {
  const item = treeItemFromEventTarget(event.target);
  if (!item || event.target !== item) return;
  if (event.key === 'Enter' && item.classList.contains('tab-main')) {
    event.preventDefault();
    cancelKeyboardNavigationActivation();
    item.click();
    return;
  }
  if (event.key === ' ' && item.classList.contains('tab-main')) {
    cancelKeyboardNavigationActivation();
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    handleTreeHorizontalNavigation(event, item);
    return;
  }
  if (!isVerticalNavigationKey(event.key)) return;
  const items = treeNavigationItems();
  const currentIndex = items.indexOf(item);
  const nextIndex = nextVerticalNavigationIndex(currentIndex, items.length, event.key);
  const nextItem = items[nextIndex];
  if (!nextItem) return;
  event.preventDefault();
  focusTreeItem(nextItem);
  queueKeyboardNavigationActivation(nextItem);
}

function handleTreeHorizontalNavigation(event: KeyboardEvent, item: HTMLElement): void {
  if (item.classList.contains('group-header')) {
    const expanded = item.getAttribute('aria-expanded') === 'true';
    if ((event.key === 'ArrowRight' && !expanded) || (event.key === 'ArrowLeft' && expanded)) {
      event.preventDefault();
      item.click();
    }
    return;
  }
  if (event.key !== 'ArrowLeft') return;
  const groupHeader = item.closest<HTMLElement>('.tab-group')?.querySelector<HTMLElement>('.group-header');
  if (!groupHeader) return;
  event.preventDefault();
  focusTreeItem(groupHeader);
}

function isVerticalNavigationKey(key: string): key is VerticalNavigationKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End';
}

function treeNavigationItems(): HTMLElement[] {
  return groups ? Array.from(groups.querySelectorAll<HTMLElement>('.tree-navigation-item')) : [];
}

function treeItemFromEventTarget(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  const item = target.closest<HTMLElement>('.tree-navigation-item');
  return item && groups?.contains(item) ? item : undefined;
}

function currentTreeFocusKey(): string | undefined {
  return treeItemFromEventTarget(document.activeElement)?.dataset.focusKey
    ?? groups?.querySelector<HTMLElement>('.tree-navigation-item[tabindex="0"]')?.dataset.focusKey;
}

function initializeTreeFocus(preferredKey: string | undefined, restoreFocus: boolean): void {
  if (!groups) return;
  const items = treeNavigationItems();
  const preferred = preferredKey
    ? items.find((item) => item.dataset.focusKey === preferredKey)
    : undefined;
  const fallback = groups.querySelector<HTMLElement>('.tab-row.is-focused .tab-main')
    ?? groups.querySelector<HTMLElement>('.tab-row.is-active .tab-main')
    ?? groups.querySelector<HTMLElement>('.tab-main')
    ?? items[0];
  const target = preferred ?? fallback;
  for (const item of items) item.tabIndex = -1;
  groups.tabIndex = target ? -1 : 0;
  if (target) target.tabIndex = 0;
  if (restoreFocus) {
    (target ?? groups).focus({ preventScroll: true });
  }
}

function setTreeTabStop(item: HTMLElement): void {
  if (!groups?.contains(item)) return;
  for (const candidate of treeNavigationItems()) candidate.tabIndex = candidate === item ? 0 : -1;
  groups.tabIndex = -1;
}

function focusTreeItem(item: HTMLElement): void {
  setTreeTabStop(item);
  item.focus();
}

function queueKeyboardNavigationActivation(item: HTMLElement): void {
  if (!item.classList.contains('tab-main') || item.getAttribute('aria-disabled') === 'true') {
    cancelKeyboardNavigationActivation();
    return;
  }
  const target = parseTargetDataset(item.closest<HTMLElement>('.tab-row')?.dataset.target);
  if (!target) {
    cancelKeyboardNavigationActivation();
    return;
  }
  keyboardNavigationActivation.queue(target);
}

function cancelKeyboardNavigationActivation(): void {
  if (keyboardNavigationActivation.hasPendingTarget) {
    keyboardNavigationActivation.cancel();
  }
}

function requestTreeFocus(): void {
  pendingTreeFocusRequest = true;
  applyPendingTreeFocusRequest();
}

function applyPendingTreeFocusRequest(): void {
  if (!pendingTreeFocusRequest || !groups) return;
  const target = groups.querySelector<HTMLElement>('.tab-row.is-focused .tab-main')
    ?? groups.querySelector<HTMLElement>('.tab-row.is-active .tab-main')
    ?? groups.querySelector<HTMLElement>('.tree-navigation-item[tabindex="0"]')
    ?? groups.querySelector<HTMLElement>('.tab-main')
    ?? groups.querySelector<HTMLElement>('.tree-navigation-item');
  if (!target) {
    if (latestSnapshot) {
      groups.tabIndex = 0;
      groups.focus({ preventScroll: true });
      pendingTreeFocusRequest = false;
    }
    return;
  }
  focusTreeItem(target);
  target.scrollIntoView({ block: 'nearest' });
  pendingTreeFocusRequest = false;
}

function treeFocusKeyForGroup(group: VerticalTabDisplayGroup): string {
  return `group:${group.id}`;
}

function treeFocusKeyForTab(tab: VerticalTabItem): string {
  return `tab:${tab.target.groupIndex}:${JSON.stringify(tab.target.identity)}`;
}

interface TreeScrollAnchor {
  readonly focusKey: string;
  readonly viewportOffset: number;
}

interface RenderCurrentTabsOptions {
  readonly preferredFocusKey?: string;
  readonly preserveScroll?: boolean;
}

function renderCurrentTabs(options: RenderCurrentTabsOptions = {}): void {
  if (!latestSnapshot || !groups || !description) return;
  const hadTreeFocus = groups.contains(document.activeElement);
  const previousTreeFocusKey = currentTreeFocusKey();
  const scrollAnchor = options.preserveScroll === false
    ? undefined
    : captureTreeScrollAnchor(options.preferredFocusKey);
  const nextTree = document.createDocumentFragment();
  const { tabs, displayGroups } = latestSnapshot;
  latestSearchResult = evaluateTabSearch(displayGroups, {
    query: currentSearchQuery,
    searchGroups: currentSearchGroups,
    searchWorkspaceRelativePaths: currentSearchWorkspaceRelativePaths,
    useRegex: currentUseRegex,
  });
  description.textContent = tabs.length === 0
    ? i18n.emptyState
    : latestSearchResult.affectsList && latestSearchResult.matchedTabCount === 0
      ? i18n.noSearchResults
      : '';
  for (const resultGroup of latestSearchResult.groups) {
    appendDisplayGroup(nextTree, resultGroup.group, resultGroup.autoExpand);
  }
  groups.replaceChildren(nextTree);
  initializeTreeFocus(previousTreeFocusKey, hadTreeFocus);
  updateSearchFeedback(latestSearchResult);
  updateTreeActionState();
  restoreTreeScrollAnchor(scrollAnchor);
}

function requestInitialSnapshot(type: 'ready' | 'requestRefresh'): void {
  logToExtension('debug', '请求标签快照', `type=${type}, attempt=${refreshAttempts + 1}`);
  vscode.postMessage(type === 'ready'
    ? { type, collapsedGroupKeys: Array.from(collapsedGroups) }
    : { type });
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

function appendDisplayGroup(parent: HTMLElement | DocumentFragment, group: VerticalTabDisplayGroup, autoExpand = false): void {
  const section = document.createElement('section');
  const collapsed = autoExpand
    ? searchCollapsedGroups.has(groupCollapseKey(group))
    : isGroupCollapsed(group);
  section.className = [
    'tab-group',
    group.showHeader ? 'with-header' : 'without-header',
    isEmptyManualRootGroup(group) ? 'empty-manual-root' : '',
    group.isPinned ? 'is-pinned-group' : '',
    group.tabs.some((tab) => tab.isFocused) ? 'has-focused-tab' : '',
    collapsed ? 'is-collapsed' : '',
  ].filter(Boolean).join(' ');
  section.dataset.groupId = group.id;
  section.setAttribute('role', 'group');
  section.addEventListener('dragover', (event) => handleGroupDragOver(event, group));
  section.addEventListener('drop', (event) => handleGroupDrop(event, group));
  if (group.showHeader) {
    const header = document.createElement('header');
    header.className = 'group-header tree-navigation-item';
    header.dataset.focusKey = treeFocusKeyForGroup(group);
    header.tabIndex = -1;
    header.setAttribute('role', 'treeitem');
    header.setAttribute('aria-level', '1');
    header.setAttribute('aria-expanded', String(!collapsed));
    header.title = collapsed ? i18n.expandGroup : i18n.collapseGroup;
    header.addEventListener('click', () => toggleRenderedDisplayGroup(group, autoExpand));
    header.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, undefined, group, header);
    });
    header.addEventListener('keydown', (event) => {
      if (openKeyboardContextMenu(event, header, undefined, group)) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleRenderedDisplayGroup(group, autoExpand);
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
    const toggle = iconButton(collapsed ? 'chevron-right' : 'chevron-down', collapsed ? i18n.expandGroup : i18n.collapseGroup);
    toggle.className = 'group-toggle';
    toggle.tabIndex = -1;
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleRenderedDisplayGroup(group, autoExpand);
    });
    main.append(toggle);
    const name = document.createElement('span');
    name.className = 'group-name';
    appendHighlightedText(name, group.title, currentSearchGroups);
    main.append(name);
    if (group.description) {
      const detail = document.createElement('span');
      detail.className = 'group-description';
      detail.textContent = group.description;
      main.append(detail);
    }
    header.append(main);
    const actions = document.createElement('div');
    actions.className = 'group-actions';
    const statuses = document.createElement('span');
    statuses.className = 'tab-status-list group-status-list';
    if (group.isPinned) {
      const pin = codicon('pinned');
      pin.classList.add('tab-status', 'group-pin-indicator');
      pin.title = i18n.pinnedGroup;
      pin.setAttribute('aria-hidden', 'true');
      statuses.append(pin);
    }
    const remove = iconButton('close', i18n.closeGroupAndDelete);
    remove.className = 'group-action tab-action group-close-action';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: 'closeGroup', groupId: group.id });
    });
    actions.append(statuses, remove);
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
  const displayPath = searchDisplayPath(tab);
  row.className = ['tab-row', `tree-level-${level}`, displayPath ? 'has-description' : '', selected ? 'is-selected' : '', multiSelected ? 'is-multi-selected' : '', tab.isActive ? 'is-active' : '', tab.isFocused ? 'is-focused' : '', tab.isDirty ? 'is-dirty' : '', tab.isPinned ? 'is-pinned' : '', tab.isPreview ? 'is-preview' : '', tab.isActivatable ? '' : 'is-unavailable'].filter(Boolean).join(' ');
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
  activate.className = 'tab-main tree-navigation-item';
  activate.type = 'button';
  activate.tabIndex = -1;
  activate.dataset.focusKey = treeFocusKeyForTab(tab);
  activate.setAttribute('role', 'treeitem');
  activate.setAttribute('aria-level', String(level + 1));
  activate.setAttribute('aria-selected', String(selected));
  activate.setAttribute('aria-disabled', String(!tab.isActivatable));
  activate.title = activationTitle(tab);
  activate.setAttribute('aria-label', tabAccessibleLabel(tab));
  const requestActivation = (targetOverride?: TabTarget) => {
    if (!tab.isActivatable) return;
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
  activate.addEventListener('keydown', (event) => {
    openKeyboardContextMenu(event, activate, tab);
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
  const text = document.createElement('span');
  text.className = 'tab-text';
  const primary = document.createElement('span');
  primary.className = 'tab-primary';
  const label = document.createElement('span');
  label.className = 'tab-label';
  appendHighlightedText(label, tab.label, true);
  primary.append(label);
  text.append(primary);
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
  if (displayPath) {
    const detail = document.createElement('span');
    detail.className = 'tab-description';
    appendHighlightedText(
      detail,
      displayPath,
      currentSearchWorkspaceRelativePaths && displayPath === tab.workspaceRelativePath,
    );
    text.append(detail);
  }
  activate.append(text);
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isSelected(tab)) selectSingle(tab);
    showContextMenu(event.clientX, event.clientY, tab, undefined, activate);
  });
  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  const statuses = document.createElement('span');
  statuses.className = 'tab-status-list';
  for (const status of tabStatusDescriptors(tab)) {
    const statusIcon = codicon(status.icon);
    statusIcon.classList.add('tab-status', `tab-status-${status.kind}`);
    statusIcon.title = status.label;
    statuses.append(statusIcon);
  }
  actions.append(statuses, closeSelectionButton(tab));
  row.append(activate, actions);
  return row;
}

function toggleDisplayGroup(group: VerticalTabDisplayGroup): void {
  setDisplayGroupCollapsed(group, !isGroupCollapsed(group));
}

function toggleRenderedDisplayGroup(group: VerticalTabDisplayGroup, autoExpanded: boolean): void {
  if (!autoExpanded) {
    toggleDisplayGroup(group);
    return;
  }
  const key = groupCollapseKey(group);
  if (searchCollapsedGroups.has(key)) searchCollapsedGroups.delete(key);
  else searchCollapsedGroups.add(key);
  applyCurrentFilter(false, treeFocusKeyForGroup(group));
}

function setAllGroupsCollapsed(collapsed: boolean): void {
  const snapshot = latestSnapshot;
  if (!snapshot) return;
  for (const group of snapshot.displayGroups) {
    if (group.showHeader) setDisplayGroupCollapsed(group, collapsed, false);
  }
  saveCollapsedGroups();
  renderCurrentTabs();
}

function setDisplayGroupCollapsed(group: VerticalTabDisplayGroup, collapsed: boolean, rerender = true): void {
  const closedKey = groupCollapseKey(group);
  const openKey = openGroupCollapseKey(group);
  collapsedGroups.delete(collapsed ? openKey : closedKey);
  collapsedGroups.add(collapsed ? closedKey : openKey);
  saveCollapsedGroups();
  if (rerender && latestSnapshot) {
    renderCurrentTabs({ preferredFocusKey: treeFocusKeyForGroup(group) });
  }
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
  const keys = Array.from(collapsedGroups);
  if (latestSnapshot) latestSnapshot = { ...latestSnapshot, collapsedGroupKeys: keys };
  if (latestSnapshot?.rememberState) vscode.setState({ collapsedGroups: keys });
  else vscode.setState({});
  vscode.postMessage({ type: 'setCollapsedGroups', keys });
}

function captureTreeScrollAnchor(preferredFocusKey?: string): TreeScrollAnchor | undefined {
  if (!groups) return undefined;
  const containerBounds = groups.getBoundingClientRect();
  const items = treeNavigationItems();
  const preferred = preferredFocusKey
    ? items.find((item) => item.dataset.focusKey === preferredFocusKey)
    : undefined;
  const anchor = preferred ?? items.find((item) => {
    const bounds = item.getBoundingClientRect();
    return bounds.bottom > containerBounds.top && bounds.top < containerBounds.bottom;
  });
  const focusKey = anchor?.dataset.focusKey;
  if (!anchor || !focusKey) return undefined;

  return {
    focusKey,
    viewportOffset: anchor.getBoundingClientRect().top - containerBounds.top,
  };
}

function restoreTreeScrollAnchor(anchor: TreeScrollAnchor | undefined): void {
  if (!groups || !anchor) return;
  const target = treeNavigationItems().find((item) => item.dataset.focusKey === anchor.focusKey);
  if (!target) return;
  const containerBounds = groups.getBoundingClientRect();
  const restoration = calculateScrollAnchorRestoration({
    currentScrollTop: groups.scrollTop,
    anchorOffsetBefore: anchor.viewportOffset,
    anchorOffsetAfter: target.getBoundingClientRect().top - containerBounds.top,
    scrollHeight: groups.scrollHeight,
    clientHeight: groups.clientHeight,
  });

  if (restoration.trailingSpace > 0) {
    const spacer = document.createElement('div');
    spacer.className = 'scroll-anchor-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = `${restoration.trailingSpace}px`;
    groups.append(spacer);
  }

  groups.scrollTop = restoration.scrollTop;
  const residualOffset = target.getBoundingClientRect().top
    - groups.getBoundingClientRect().top
    - anchor.viewportOffset;
  if (Math.abs(residualOffset) > 0.5) groups.scrollTop += residualOffset;
}

function clearScrollAnchorCompensationWhenSafe(): void {
  if (!groups) return;
  const spacer = groups.querySelector<HTMLElement>('.scroll-anchor-spacer');
  if (
    !spacer
    || !isWithinNaturalScrollRange(
      groups.scrollTop,
      groups.scrollHeight,
      groups.clientHeight,
      spacer.offsetHeight,
    )
  ) {
    return;
  }
  spacer.remove();
}

function updateTreeActionState(): void {
  const groupsWithHeaders = latestSnapshot?.displayGroups.filter((group) => group.showHeader) ?? [];
  const hasGroups = groupsWithHeaders.length > 0 && !latestSearchResult?.affectsList;
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
  const title = [tab.tooltipPath ?? tab.label, ...tabStatusLabels(tab)].join(' · ');
  if (tab.activationKind === 'reliable') return title;
  if (tab.activationKind === 'bestEffort') return `${title} · ${i18n.bestEffortActivation}`;
  return `${title} · ${i18n.unsupportedActivation}`;
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

function prepareActiveTabFollow(
  snapshot: Extract<ExtensionMessage, { type: 'renderTabs' }>['snapshot'],
): TabTarget | undefined {
  const focusedTab = snapshot.tabs.find((tab) => tab.isFocused);
  if (!activeTabFollowTracker.shouldFollow(focusedTab?.target, snapshot.alwaysFollowActiveTab) || !focusedTab) {
    return undefined;
  }
  const focusedGroup = snapshot.displayGroups.find((group) =>
    group.tabs.some((tab) => sameTarget(tab.target, focusedTab.target)));
  if (focusedGroup?.showHeader && isGroupCollapsed(focusedGroup)) {
    setDisplayGroupCollapsed(focusedGroup, false, false);
  }
  return focusedTab.target;
}

function revealFollowedTab(target: TabTarget | undefined): void {
  if (!target) return;
  window.requestAnimationFrame(() => {
    findTabRow(target)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function iconButton(icon: string, title: string): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.tabIndex = -1;
  result.title = title;
  result.setAttribute('aria-label', title);
  result.append(codicon(icon));
  return result;
}

function codicon(name: string): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = `codicon codicon-${name}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function setAccessibleButtonLabel(target: HTMLButtonElement | null, label: string): void {
  if (!target) return;
  target.title = label;
  target.setAttribute('aria-label', label);
}

function tabAccessibleLabel(tab: VerticalTabItem): string {
  return [tab.label, tab.description, ...tabStatusLabels(tab)]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

interface TabStatusDescriptor {
  readonly kind: string;
  readonly icon: string;
  readonly label: string;
}

function tabStatusDescriptors(tab: VerticalTabItem): readonly TabStatusDescriptor[] {
  const statuses: TabStatusDescriptor[] = [];
  if (tab.isPreview) statuses.push({ kind: 'preview', icon: 'preview', label: i18n.previewTab });
  if (tab.isPinned) statuses.push({ kind: 'pinned', icon: 'pinned', label: i18n.pinnedTab });
  if (tab.resourceStatus === 'readonly') statuses.push({ kind: 'readonly', icon: 'lock-small', label: i18n.readonlyResource });
  if (tab.isDirty) statuses.push({ kind: 'dirty', icon: 'circle-filled', label: i18n.unsavedChanges });
  if (tab.resourceStatus === 'missing') statuses.push({ kind: 'missing', icon: 'error-small', label: i18n.resourceMissing });
  if (tab.resourceStatus === 'noPermissions') statuses.push({ kind: 'no-permissions', icon: 'shield', label: i18n.resourceNoPermissions });
  if (tab.resourceStatus === 'unavailable') statuses.push({ kind: 'resource-unavailable', icon: 'debug-disconnect', label: i18n.resourceUnavailable });
  if (!tab.isActivatable) statuses.push({ kind: 'navigation-unavailable', icon: 'circle-slash', label: i18n.unsupportedActivation });
  return statuses;
}

function tabStatusLabels(tab: VerticalTabItem): readonly string[] {
  return tabStatusDescriptors(tab).map((status) => status.label);
}

function actionButton(label: string, title: string, type: 'closeTab' | 'closeOthers' | 'closeBelow', target: TabTarget, dismissAfterClick = false): HTMLButtonElement {
  const result = button(label, title);
  result.className = 'tab-action';
  result.addEventListener('click', () => { postTarget(type, target); if (dismissAfterClick) dismissContextMenu(); });
  return result;
}

function closeSelectionButton(tab: VerticalTabItem): HTMLButtonElement {
  const result = iconButton('close', i18n.closeTab);
  result.className = 'tab-action tab-close-action';
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
  postSelectionChanged();
}

function updateSelection(tab: VerticalTabItem, keys: { readonly shiftKey: boolean; readonly toggleKey: boolean }): void {
  selection.update(selectableTabs(), tab, keys);
  postSelectionChanged();
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

function postSelectionChanged(): void {
  const targets = latestSnapshot?.displayGroups
    .flatMap((group) => group.tabs)
    .filter((tab) => selection.isSelected(tab))
    .map((tab) => tab.target) ?? [];
  vscode.postMessage({ type: 'selectionChanged', targets });
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

function nextNativeMenuRequestId(): string {
  nativeMenuRequestSequence = (nativeMenuRequestSequence % Number.MAX_SAFE_INTEGER) + 1;
  return `native-menu-${nativeMenuRequestSequence}`;
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

function showContextMenu(
  x: number,
  y: number,
  tab?: VerticalTabItem,
  group?: VerticalTabDisplayGroup,
  invoker?: HTMLElement,
): void {
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
  menu.querySelectorAll<HTMLButtonElement>('button').forEach((item) => {
    item.classList.add('tab-context-action');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
  });
  menu.addEventListener('keydown', handleContextMenuKeyDown);
  document.body.append(menu);
  positionContextMenu(menu, x, y);
  contextMenu = menu;
  contextMenuInvoker = invoker;
  focusContextMenuItem(menu, 0);
  if (tab && snapshot?.nativeContextMenuActionsEnabled) {
    const requestId = nextNativeMenuRequestId();
    pendingNativeMenuRequest = { requestId, target: tab.target, menu, x, y };
    vscode.postMessage({ type: 'requestNativeTabMenu', requestId, target: tab.target });
  }
}

function renderNativeContextMenu(requestId: string, entries: readonly NativeContextMenuEntry[]): void {
  const pending = pendingNativeMenuRequest;
  if (!pending || pending.requestId !== requestId || contextMenu !== pending.menu || !pending.menu.isConnected) return;
  pendingNativeMenuRequest = undefined;
  if (!hasNativeMenuAction(entries)) return;
  pending.menu.append(createContextMenuSeparator(), ...nativeContextMenuElements(entries, pending.target));
  positionContextMenu(pending.menu, pending.x, pending.y);
}

function nativeContextMenuElements(entries: readonly NativeContextMenuEntry[], target: TabTarget): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const entry of entries) {
    if (entry.kind === 'separator') {
      if (elements.length > 0 && !elements[elements.length - 1]?.classList.contains('tab-context-separator')) {
        elements.push(createContextMenuSeparator());
      }
      continue;
    }
    if (entry.kind === 'submenu') {
      const children = nativeContextMenuElements(entry.entries, target);
      if (!children.some((element) => !element.classList.contains('tab-context-separator'))) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'tab-context-submenu';
      const trigger = button(entry.label, entry.label);
      trigger.classList.add('tab-context-action', 'tab-context-submenu-trigger');
      trigger.setAttribute('role', 'menuitem');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.tabIndex = -1;
      const submenu = document.createElement('div');
      submenu.className = 'tab-context-submenu-list';
      submenu.setAttribute('role', 'menu');
      submenu.append(...children);
      trigger.addEventListener('click', () => {
        openContextSubmenu(trigger, submenu);
        focusContextMenuItem(submenu, 0);
      });
      wrapper.addEventListener('mouseenter', () => openContextSubmenu(trigger, submenu));
      wrapper.addEventListener('mouseleave', () => {
        if (!wrapper.contains(document.activeElement)) closeContextSubmenu(trigger);
      });
      wrapper.addEventListener('focusout', (event) => {
        if (!(event.relatedTarget instanceof Node) || !wrapper.contains(event.relatedTarget)) closeContextSubmenu(trigger);
      });
      wrapper.append(trigger, submenu);
      elements.push(wrapper);
      continue;
    }
    const action = button(entry.label, entry.label);
    action.classList.add('tab-context-action');
    action.setAttribute('role', 'menuitem');
    action.tabIndex = -1;
    action.disabled = !entry.enabled;
    action.addEventListener('click', () => {
      if (!entry.enabled) return;
      vscode.postMessage({ type: 'runNativeTabMenuAction', actionId: entry.actionId, target });
      dismissContextMenu();
    });
    elements.push(action);
  }
  while (elements[0]?.classList.contains('tab-context-separator')) elements.shift();
  while (elements[elements.length - 1]?.classList.contains('tab-context-separator')) elements.pop();
  return elements;
}

function hasNativeMenuAction(entries: readonly NativeContextMenuEntry[]): boolean {
  return entries.some((entry) => entry.kind === 'action' || (entry.kind === 'submenu' && hasNativeMenuAction(entry.entries)));
}

function createContextMenuSeparator(): HTMLDivElement {
  const separator = document.createElement('div');
  separator.className = 'tab-context-separator';
  separator.setAttribute('role', 'separator');
  return separator;
}

function positionContextMenu(menu: HTMLElement, x: number, y: number): void {
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4))}px`;
}

function openContextSubmenu(trigger: HTMLButtonElement, submenu: HTMLElement): void {
  const wrapper = trigger.parentElement;
  if (!wrapper) return;
  trigger.setAttribute('aria-expanded', 'true');
  wrapper.classList.add('is-open');
  wrapper.classList.toggle('opens-left', submenu.getBoundingClientRect().right > window.innerWidth - 4);
}

function closeContextSubmenu(trigger: HTMLButtonElement): void {
  trigger.setAttribute('aria-expanded', 'false');
  trigger.parentElement?.classList.remove('is-open', 'opens-left');
}

function openKeyboardContextMenu(
  event: KeyboardEvent,
  invoker: HTMLElement,
  tab?: VerticalTabItem,
  group?: VerticalTabDisplayGroup,
): boolean {
  if (!isKeyboardContextMenuKey(event.key, event.shiftKey)) return false;
  event.preventDefault();
  event.stopPropagation();
  const bounds = invoker.getBoundingClientRect();
  showContextMenu(
    bounds.left + Math.min(24, bounds.width / 2),
    bounds.top + Math.min(24, bounds.height),
    tab,
    group,
    invoker,
  );
  return true;
}

function handleContextMenuKeyDown(event: KeyboardEvent): void {
  const menu = event.currentTarget;
  if (!(menu instanceof HTMLElement)) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    dismissContextMenu(true);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    const action = event.target;
    if (!(action instanceof HTMLButtonElement) || action.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    action.click();
    return;
  }
  if (event.key === 'ArrowRight') {
    const action = event.target;
    if (!(action instanceof HTMLButtonElement) || !action.classList.contains('tab-context-submenu-trigger')) return;
    const submenu = action.nextElementSibling;
    if (!(submenu instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    openContextSubmenu(action, submenu);
    focusContextMenuItem(submenu, 0);
    return;
  }
  if (event.key === 'ArrowLeft') {
    const action = event.target;
    if (!(action instanceof HTMLButtonElement)) return;
    const submenu = action.closest<HTMLElement>('.tab-context-submenu-list');
    const trigger = submenu?.parentElement?.querySelector<HTMLButtonElement>(':scope > .tab-context-submenu-trigger');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    closeContextSubmenu(trigger);
    trigger.focus();
    return;
  }
  if (!isVerticalNavigationKey(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const level = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>('.tab-context-submenu-list') ?? menu
    : menu;
  const actions = enabledContextMenuItems(level);
  const currentIndex = actions.findIndex((item) => item === document.activeElement);
  const nextIndex = nextVerticalNavigationIndex(currentIndex, actions.length, event.key, true);
  focusContextMenuItem(level, nextIndex);
}

function enabledContextMenuItems(menu: HTMLElement): HTMLButtonElement[] {
  const result: HTMLButtonElement[] = [];
  for (const child of Array.from(menu.children)) {
    if (child instanceof HTMLButtonElement && !child.disabled) {
      result.push(child);
    } else if (child.classList.contains('tab-context-submenu')) {
      const trigger = child.querySelector<HTMLButtonElement>(':scope > .tab-context-submenu-trigger:not(:disabled)');
      if (trigger) result.push(trigger);
    }
  }
  return result;
}

function focusContextMenuItem(menu: HTMLElement, index: number): void {
  const actions = enabledContextMenuItems(menu);
  const target = actions[index];
  if (!target) return;
  for (const action of actions) action.tabIndex = action === target ? 0 : -1;
  target.focus();
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

function previewKeyboardNavigation(target: TabTarget): void {
  keyboardNavigationPreviewTarget = target;
  applyKeyboardNavigationPreview();
}

function clearKeyboardNavigationPreview(): void {
  keyboardNavigationPreviewTarget = undefined;
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.tab-row.is-keyboard-preview'))) {
    row.classList.remove('is-keyboard-preview');
  }
}

function applyKeyboardNavigationPreview(): void {
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.tab-row.is-keyboard-preview'))) {
    row.classList.remove('is-keyboard-preview');
  }
  if (!keyboardNavigationPreviewTarget) return;
  const row = findTabRow(keyboardNavigationPreviewTarget);
  if (!row) return;
  row.classList.add('is-keyboard-preview');
  row.scrollIntoView({ block: 'nearest' });
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

function dismissContextMenu(restoreFocus = false): void {
  const invoker = contextMenuInvoker;
  contextMenu?.remove();
  contextMenu = undefined;
  contextMenuInvoker = undefined;
  pendingNativeMenuRequest = undefined;
  if (!restoreFocus || !invoker?.isConnected) return;
  if (invoker.classList.contains('tree-navigation-item')) setTreeTabStop(invoker);
  invoker.focus({ preventScroll: true });
}


type _GroupModeCheck = GroupMode;

function setSearchContainerVisible(visible: boolean): void {
  if (searchContainer) { searchContainer.hidden = !visible; }
  setAccessibleButtonLabel(toggleSearchButton, visible ? i18n.hideSearch : i18n.showSearch);
  toggleSearchButton?.setAttribute('aria-pressed', String(visible));
}

function applyCurrentFilter(resetSearchCollapses = false, preferredFocusKey?: string): void {
  if (resetSearchCollapses) searchCollapsedGroups.clear();
  renderCurrentTabs({ preferredFocusKey });
}

function clearSearch(rerender = true): void {
  currentSearchQuery = '';
  searchCollapsedGroups.clear();
  if (searchInput) searchInput.value = '';
  updateSearchControlState();
  if (rerender) applyCurrentFilter();
}

function updateSearchControlState(): void {
  setToggleState(searchGroupToggle, currentSearchGroups);
  setToggleState(regexSearchToggle, currentUseRegex);
  setToggleState(searchWorkspaceRelativePathToggle, currentSearchWorkspaceRelativePaths);
}

function setToggleState(button: HTMLButtonElement | null, active: boolean): void {
  button?.classList.toggle('is-active', active);
  button?.setAttribute('aria-pressed', String(active));
}

function updateSearchFeedback(result: TabSearchResult): void {
  if (searchResultCount) {
    searchResultCount.hidden = !result.active || Boolean(result.regexError);
    searchResultCount.textContent = currentSearchGroups
      ? formatI18n(i18n.searchResultCountWithGroups, result.matchedTabCount, result.matchedGroupCount)
      : formatI18n(i18n.searchResultCount, result.matchedTabCount);
  }
  if (searchError) {
    searchError.hidden = !result.regexError;
    searchError.textContent = result.regexError
      ? formatI18n(i18n.invalidRegex, result.regexError)
      : '';
  }
  searchInput?.setAttribute('aria-invalid', String(Boolean(result.regexError)));
}

function appendHighlightedText(parent: HTMLElement, value: string, highlightEnabled: boolean): void {
  const ranges = highlightEnabled && latestSearchResult?.queryActive
    ? findTextMatchRanges(value, currentSearchQuery, currentUseRegex)
    : [];
  if (ranges.length === 0) {
    parent.textContent = value;
    return;
  }
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset) parent.append(document.createTextNode(value.slice(offset, range.start)));
    const mark = document.createElement('mark');
    mark.className = 'search-match';
    mark.textContent = value.slice(range.start, range.end);
    parent.append(mark);
    offset = range.end;
  }
  if (offset < value.length) parent.append(document.createTextNode(value.slice(offset)));
}

function searchDisplayPath(tab: VerticalTabItem): string | undefined {
  if (!latestSearchResult?.queryActive || !currentSearchWorkspaceRelativePaths) return tab.description;
  const path = tab.workspaceRelativePath;
  return path && findTextMatchRanges(path, currentSearchQuery, currentUseRegex).length > 0
    ? path
    : tab.description;
}

function formatI18n(message: string, ...args: readonly (string | number)[]): string {
  return args.reduce<string>(
    (result, value, index) => result.replace(`{${index}}`, String(value)),
    message,
  );
}
type _SortModeCheck = SortMode;
