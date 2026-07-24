import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../../src/i18n';
import { buildStatusBarPresentation } from '../../src/statusbar/statusBarPresentation';

test('status bar toggle reflects panel visibility and configured side', () => {
  const strings = getStrings('en');

  assert.deepEqual(buildStatusBarPresentation(false, 'left', strings), {
    text: '$(layout-sidebar-left)',
    tooltip: 'Show Vertical Tabs',
    accessibilityLabel: 'Show Vertical Tabs',
    name: 'Vertical Tabs',
  });
  assert.deepEqual(buildStatusBarPresentation(true, 'left', strings), {
    text: '$(layout-sidebar-left-off)',
    tooltip: 'Hide Vertical Tabs',
    accessibilityLabel: 'Hide Vertical Tabs',
    name: 'Vertical Tabs',
  });
  assert.deepEqual(buildStatusBarPresentation(false, 'right', strings), {
    text: '$(layout-sidebar-right)',
    tooltip: 'Show Vertical Tabs',
    accessibilityLabel: 'Show Vertical Tabs',
    name: 'Vertical Tabs',
  });
  assert.deepEqual(buildStatusBarPresentation(true, 'right', strings), {
    text: '$(layout-sidebar-right-off)',
    tooltip: 'Hide Vertical Tabs',
    accessibilityLabel: 'Hide Vertical Tabs',
    name: 'Vertical Tabs',
  });
});

test('every supported locale provides status bar labels', () => {
  for (const locale of ['en', 'zh-cn', 'zh-tw', 'ja', 'ko', 'de', 'fr', 'es', 'pt-br', 'ru']) {
    const strings = getStrings(locale);
    assert.ok(strings.verticalTabsStatusBarName, `${locale} should localize the status bar item name.`);
    assert.ok(strings.showVerticalTabs, `${locale} should localize the show tooltip.`);
    assert.ok(strings.hideVerticalTabs, `${locale} should localize the hide tooltip.`);
  }
});
