import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../../src/i18n';

const supportedLocales = ['en', 'zh-cn', 'zh-tw', 'ja', 'ko', 'de', 'fr', 'es', 'pt-br', 'ru'] as const;
const nativeContextMenuKeys = [
  'nativeContextMenuTitle',
  'nativeContextMenuWarning',
  'nativeContextMenuDetails',
] as const;

test('all ten supported interface languages explain the native context-menu section', () => {
  for (const locale of supportedLocales) {
    const strings = getStrings(locale);
    for (const key of nativeContextMenuKeys) {
      assert.ok(strings[key].trim().length > 0, `${locale}.${key} must be localized`);
    }
    assert.match(strings.nativeContextMenuDetails, /verticalTabs\.showNativeContextMenuActions/);
  }
});
