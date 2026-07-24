import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../../src/i18n';

const supportedLocales = ['en', 'zh-cn', 'zh-tw', 'ja', 'ko', 'de', 'fr', 'es', 'pt-br', 'ru'] as const;
const statusKeys = [
  'previewTab',
  'pinnedTab',
  'readonlyResource',
  'unsavedChanges',
  'resourceMissing',
  'resourceNoPermissions',
  'resourceUnavailable',
  'unsupportedActivation',
  'closeTab',
] as const;

test('all ten supported interface languages localize tab statuses and the close action', () => {
  for (const locale of supportedLocales) {
    const strings = getStrings(locale);
    for (const key of statusKeys) {
      assert.ok(strings[key].trim().length > 0, `${locale}.${key} must be localized`);
    }
  }
});
