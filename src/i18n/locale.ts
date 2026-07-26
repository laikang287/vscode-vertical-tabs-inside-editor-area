export interface LocaleStrings {
  readonly emptyState: string;
  readonly openEditorTabs: string;
  readonly verticalTabsStatusBarName: string;
  readonly showVerticalTabs: string;
  readonly hideVerticalTabs: string;
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
  readonly moveRequiresManualSort: string;
  readonly cannotMoveBetweenFileTypeGroups: string;
  readonly rename: string;
  readonly renameGroup: string;
  readonly groupName: string;
  readonly groupNamePrompt: string;
  readonly groupNameRequired: string;
  readonly groupNameTooLong: string;
  readonly newGroup: string;
  readonly newGroupOnlyManual: string;
  readonly back: string;
  readonly moveToGroup: string;
  readonly moveToManualGroup: string;
  readonly moveToVscodeGroup: string;
  readonly moveOutOfGroup: string;
  readonly moveToNamedGroup: string;
  readonly unknownTab: string;
  readonly previewTab: string;
  readonly pinnedTab: string;
  readonly readonlyResource: string;
  readonly resourceMissing: string;
  readonly resourceNoPermissions: string;
  readonly resourceUnavailable: string;
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
  readonly sortModeMru: string;
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
  readonly searchWorkspaceRelativePaths: string;
  readonly searchResultCount: string;
  readonly searchResultCountWithGroups: string;
  readonly noSearchResults: string;
  readonly nativeMenuActionFailed: string;
  readonly moveRailFailed: string;
  readonly sideLeft: string;
  readonly sideRight: string;
  readonly overwriteFileConfirm: string;
  readonly overwriteFileDirtyDetail: string;
  readonly overwriteFileDetail: string;
  readonly cancel: string;
  readonly webviewStyleLoadFailed: string;
  readonly webviewScriptLoadFailed: string;
  readonly nativeReopenEditorWith: string;
  readonly nativeSplitEditor: string;
  readonly nativeSplitUp: string;
  readonly nativeSplitDown: string;
  readonly nativeSplitLeft: string;
  readonly nativeSplitRight: string;
  readonly nativeMoveIntoPreviousGroup: string;
  readonly nativeMoveIntoNextGroup: string;
  readonly nativeMoveIntoLeftGroup: string;
  readonly nativeMoveIntoRightGroup: string;
  readonly nativeSplitInGroup: string;
  readonly nativeJoinInGroup: string;
  readonly nativeMoveIntoNewWindow: string;
  readonly nativeCopyIntoNewWindow: string;
  readonly nativeCopyPath: string;
  readonly nativeCopyRelativePath: string;
  readonly nativeRevealInFileExplorer: string;
  readonly nativeCompareWithSelected: string;
  readonly nativeMoveTerminalIntoPanel: string;
  readonly nativeRenameTerminal: string;
  readonly nativeChangeTerminalColor: string;
  readonly nativeChangeTerminalIcon: string;
  readonly nativeSizeTerminalToContentWidth: string;
  readonly nativeSplitMove: string;
  readonly nativeShare: string;
  readonly worksets: string;
  readonly saveWorkset: string;
  readonly loadWorkset: string;
  readonly manageWorksets: string;
  readonly createWorkset: string;
  readonly createWorksetDescription: string;
  readonly worksetNamePrompt: string;
  readonly worksetNamePlaceholder: string;
  readonly worksetNameRequired: string;
  readonly worksetNameTooLong: string;
  readonly worksetNameExists: string;
  readonly selectWorkset: string;
  readonly selectWorksetAction: string;
  readonly noWorksets: string;
  readonly worksetTabCount: string;
  readonly worksetUpdatedAt: string;
  readonly load: string;
  readonly overwrite: string;
  readonly delete: string;
  readonly renameWorkset: string;
  readonly showReport: string;
  readonly worksetOverwriteConfirm: string;
  readonly worksetOverwriteDetail: string;
  readonly worksetDeleteConfirm: string;
  readonly worksetDeleteDetail: string;
  readonly worksetLoadConfirm: string;
  readonly worksetSaved: string;
  readonly worksetOverwritten: string;
  readonly worksetRenamed: string;
  readonly worksetDeleted: string;
  readonly worksetLoaded: string;
  readonly worksetRestoreCloseCount: string;
  readonly worksetRestoreProtectedCount: string;
  readonly worksetAffectedUnsaved: string;
  readonly worksetPreflightFailures: string;
  readonly worksetEditorGroupUnavailable: string;
  readonly worksetOpenDidNotCreateTab: string;
  readonly worksetExistingTabActivationFailed: string;
  readonly worksetUnsupportedTab: string;
  readonly worksetUntitledUnavailable: string;
  readonly worksetWorkspaceUnavailable: string;
  readonly worksetAmbiguousCandidates: string;
  readonly worksetProtectedGroupRetained: string;
  readonly worksetRestoreSummary: string;
  readonly worksetRestoreReportTitle: string;
  readonly worksetFailureNotFound: string;
  readonly worksetFailureMoved: string;
  readonly worksetFailureDeleted: string;
  readonly worksetFailurePermission: string;
  readonly worksetFailureUnsupported: string;
  readonly worksetFailureOpen: string;
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
  'zh-hans': 'zh-cn',
  'zh-sg': 'zh-cn',
  'zh_cn': 'zh-cn',
  'zh-tw': 'zh-tw',
  'zh-hant': 'zh-tw',
  'zh-hk': 'zh-tw',
  'zh-mo': 'zh-tw',
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
