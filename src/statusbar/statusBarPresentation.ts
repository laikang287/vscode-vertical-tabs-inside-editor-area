import type { LocaleStrings } from '../i18n';

export type VerticalTabsSide = 'left' | 'right';

export interface VerticalTabsStatusBarPresentation {
  readonly text: string;
  readonly tooltip: string;
  readonly accessibilityLabel: string;
  readonly name: string;
}

type StatusBarStrings = Pick<
  LocaleStrings,
  'verticalTabsStatusBarName' | 'showVerticalTabs' | 'hideVerticalTabs'
>;

export function buildStatusBarPresentation(
  visible: boolean,
  side: VerticalTabsSide,
  strings: StatusBarStrings,
): VerticalTabsStatusBarPresentation {
  const action = visible ? strings.hideVerticalTabs : strings.showVerticalTabs;
  const icon = visible
    ? `layout-sidebar-${side}-off`
    : `layout-sidebar-${side}`;

  return {
    text: `$(${icon})`,
    tooltip: action,
    accessibilityLabel: action,
    name: strings.verticalTabsStatusBarName,
  };
}
