# Changelog

[English](CHANGELOG.md) · [简体中文（规范源）](CHANGELOG.zh-CN.md) · [繁體中文](docs/CHANGELOG.zh-TW.md) · [日本語](docs/CHANGELOG.ja.md) · [한국어](docs/CHANGELOG.ko.md) · [Español](docs/CHANGELOG.es.md) · [Français](docs/CHANGELOG.fr.md) · [Deutsch](docs/CHANGELOG.de.md) · [Русский](docs/CHANGELOG.ru.md)

## [1.0.0] - 2026-07-23

<mark>This is a major update. Due to the large number of changes, consider reverting to version 0.2.1 if you encounter bugs.</mark>

### Key Features

- <mark>The context menu in the vertical tabs can display every action available in VS Code's horizontal tab context menu, including actions contributed by VS Code itself and third-party extensions.</mark>
- Updated the interface styling to better match VS Code themes.
- Added support for saving and loading worksets.
- Added support for placing the vertical tabs on either the left or right.
- Enhanced search.
- Added the `verticalTabs.relativePathDisplay` setting, which controls when a tab displays a path—for example, showing the parent directory only for files with duplicate names.
- Added multiple configurable shortcuts for switching and moving tabs.
    - See the keyboard shortcut descriptions for details.
    - No shortcuts are bound by default; bind them as needed.
    - `verticalTabs.previousAcrossGroups` and `verticalTabs.nextAcrossGroups` switch to the previous and next tab across groups. <mark>These commands are used very frequently. Consider binding them to `Ctrl+Tab` and `Ctrl+Shift+Tab`, overriding VS Code's default shortcuts.</mark>
- Added multiple settings; see the setting descriptions for details.

### Native VS Code Context Menu Integration

- Tab context menus can now display actions registered by VS Code itself and by other extensions for the native editor tab menu.
- Added the `verticalTabs.showNativeContextMenuActions` setting, which controls whether native VS Code context menu actions are enabled. It is enabled by default.
- Native submenus can be opened and operated with the keyboard.
- Notes:

### Tab Search and Navigation

- Added real-time tab search with filtering by tab name.
- Workspace-relative path search can be enabled, with matched paths displayed and highlighted in the results.
- Added regular expression search. Invalid regular expressions display an error without disrupting the current list.
- Displays the number of matching tabs and groups, and highlights matched text.
- Groups containing results expand automatically during a search; clearing the search restores their previous collapsed state.

### Path Display and Duplicate Filename Disambiguation

The `verticalTabs.relativePathDisplay` setting now provides five modes:

- Do not display paths.
- Display the parent directory only for files with duplicate names.
- Display the workspace-relative path only for files with duplicate names.
- Always display the parent directory for every file.
- Always display the workspace-relative path for every file.

Paths appear below tab names. Files in the workspace root and files outside the workspace use recognizable parent-directory information as additional context.

### Tab Navigation, Sorting, and Movement

- Added a Most Recently Used sorting mode that globally sorts tabs by the time they were last activated successfully.
- Newly opened and activated tabs become the most recently used items; tabs that have not been activated retain a stable order.
- Added the Always Follow Active Tab setting. After switching editors, the corresponding group expands automatically and the active tab scrolls into view.
- Added eight configurable commands:
    - Switch to the previous or next tab within a group.
    - Switch to the previous or next tab across groups.
    - Move tabs up or down within the current group.
    - Move tabs to the previous or next group.
- Movement commands support multi-selection and preserve the relative order of selected tabs.
- Manual sorting supports movement within a group. Directory grouping supports moving files across groups, while file-type grouping blocks cross-group moves that would violate the grouping rule.

### Worksets and Session Restoration

- Added workspace-scoped worksets that can save:
    - Currently open tabs.
    - Native editor groups and tab order.
    - The active tab.
    - Manual groups and manual sorting.
    - Pinned states for tabs and tab groups.
    - Collapsed states for groups.
    - The current grouping and sorting modes.
- Worksets can be created, loaded, overwritten, renamed, and deleted from the Command Palette or the vertical tab bar.
- Before loading, the extension lists tabs that may be closed and any unsaved tabs. Unsaved and pinned tabs are protected by default.
- If an original path is missing, the extension automatically associates it only when the workspace contains exactly one file with the same name, preventing incorrect restoration.

### Tab Status Display

- Note: This area has not been fully tested.
- Added read-only resource states, including file-system read-only, permission-based read-only, and VS Code read-only rules.
- Added states for missing resources, insufficient permissions, and unavailable file systems.
- States refresh after files are deleted or restored, or when permissions or read-only settings change.
- The right side of a tab consistently displays preview, pinned, read-only, unsaved, resource error, and unavailable navigation states.
- The unsaved state is displayed next to the close button.
- More width is available for tab text. The close button appears only on hover or when keyboard focus enters the tab.

### Layout, Position, and Entry Points

- Added `verticalTabs.position`, which places the vertical tab bar on the left or right side of the editor area and applies changes immediately.
- Added `verticalTabs.toolbarPosition`, which pins the toolbar above or below the tab list.
- Added a persistent show/hide button to the right side of the status bar. Its icon changes with the tab bar's position and visibility.
- The final interface uses VS Code theme colors and Codicon action buttons.

### Keyboard and Accessibility

- When focus is on an empty area of the vertical tabs, the arrow keys, `Home`, `End`, and `Enter` can be used to navigate to and activate tabs.
    - This has limited practical usefulness: after using the keyboard to move to or activate a tab, focus moves inside the tab, so subsequent navigation within the vertical tabs is unavailable.
- Tab and group menus support the Menu key, `Shift+F10`, the arrow keys, `Enter`, Space, and `Esc`.

## [0.2.1] - 2026-07-23

Bundled the updated README with the release.

## [0.2.0] - 2026-07-23

Completed the initial release.
