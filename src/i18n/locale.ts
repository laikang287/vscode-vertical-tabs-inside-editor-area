export interface LocaleStrings {
  readonly emptyState: string;
  readonly expand: string;
  readonly collapse: string;
  readonly expandGroup: string;
  readonly collapseGroup: string;
  readonly pinnedGroup: string;
  readonly closeGroupAndDelete: string;
  readonly closeTab: string;
  readonly unsavedChanges: string;
  readonly close: string;
  readonly closeOthers: string;
  readonly closeBelow: string;
  readonly closeGroup: string;
  readonly closeSaved: string;
  readonly closeAll: string;
  readonly closeSavedTabs: string;
  readonly closeAllUnpinned: string;
  readonly pinTab: string;
  readonly unpinTab: string;
  readonly pinGroup: string;
  readonly unpinGroup: string;
  readonly cannotPinVscodeGroup: string;
  readonly rename: string;
  readonly renameGroup: string;
  readonly groupName: string;
  readonly newGroup: string;
  readonly newGroupOnlyManual: string;
  readonly previewSuffix: string;
  readonly bestEffortActivation: string;
  readonly unsupportedActivation: string;
  readonly hideToolbarControls: string;
  readonly showToolbarControls: string;
  readonly ungrouped: string;
  readonly other: string;
  readonly workspaceRoot: string;
  readonly noExtension: string;
  readonly editorGroup: string;
  readonly groupModeLabel: string;
  readonly groupModeVscode: string;
  readonly groupModeManual: string;
  readonly groupModeParentDir: string;
  readonly groupModeFileType: string;
  readonly sortModeLabel: string;
  readonly sortModeNone: string;
  readonly sortModeModifiedAsc: string;
  readonly sortModeModifiedDesc: string;
  readonly sortModeNameAsc: string;
  readonly sortModeNameDesc: string;
  readonly searchPlaceholder: string;
  readonly searchGroup: string;
  readonly showSearch: string;
  readonly hideSearch: string;
  readonly regexSearch: string;
  readonly invalidRegex: string;
  readonly filterTabs: string;
  readonly filterUnsaved: string;
  readonly filterPinned: string;
  readonly filterCurrentGroup: string;
  readonly filterFileType: string;
  readonly allFileTypes: string;
  readonly searchResultCount: string;
  readonly searchResultCountWithGroups: string;
  readonly noSearchResults: string;
}

export type SupportedLocale =
  | 'en'
  | 'zh-cn'
  | 'zh-tw'
  | 'ja'
  | 'ko'
  | 'de'
  | 'fr'
  | 'es'
  | 'pt-br'
  | 'ru';

const VSCODE_LANGUAGE_MAP: Readonly<Record<string, SupportedLocale>> = {
  'en': 'en',
  'zh-cn': 'zh-cn',
  'zh-tw': 'zh-tw',
  'ja': 'ja',
  'ko': 'ko',
  'de': 'de',
  'fr': 'fr',
  'es': 'es',
  'pt-br': 'pt-br',
  'ru': 'ru',
};

const NORMALIZED_MAP: Readonly<Record<string, SupportedLocale>> = {
  'zh_cn': 'zh-cn',
  'zh-tw': 'zh-tw',
  'zh_tw': 'zh-tw',
  'pt_br': 'pt-br',
  'pt': 'pt-br',
};

export function resolveLocale(configValue: string): SupportedLocale {
  const lowered = configValue.toLowerCase().trim();
  if (VSCODE_LANGUAGE_MAP[lowered]) {
    return VSCODE_LANGUAGE_MAP[lowered];
  }
  const normalized = NORMALIZED_MAP[lowered];
  if (normalized) {
    return normalized;
  }
  const prefix = lowered.split('-')[0];
  for (const key of Object.keys(VSCODE_LANGUAGE_MAP)) {
    if (key.startsWith(prefix)) {
      return VSCODE_LANGUAGE_MAP[key];
    }
  }
  return 'en';
}
