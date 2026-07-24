import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getStrings, resolveLocale } from '../../src/i18n';

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

test('all runtime locales provide the complete English key set with matching placeholders', () => {
  const english = getStrings('en') as unknown as Readonly<Record<string, string>>;
  const englishKeys = Object.keys(english).sort();
  const placeholders = (value: string): string[] => Array.from(value.matchAll(/\{\d+\}/g), (match) => match[0]).sort();

  for (const locale of supportedLocales) {
    const strings = getStrings(locale) as unknown as Readonly<Record<string, string>>;
    assert.deepEqual(Object.keys(strings).sort(), englishKeys, `${locale} runtime keys must match English`);
    for (const key of englishKeys) {
      assert.ok(strings[key]?.trim(), `${locale}.${key} must not be empty`);
      assert.deepEqual(
        placeholders(strings[key]!),
        placeholders(english[key]!),
        `${locale}.${key} placeholders must match English`,
      );
    }
  }
});

test('critical runtime UI surfaces are translated in every non-English locale', () => {
  const english = getStrings('en');
  const criticalKeys = [
    'openEditorTabs',
    'groupNamePrompt',
    'overwriteFileConfirm',
    'nativeMenuActionFailed',
    'nativeSplitEditor',
    'webviewScriptLoadFailed',
  ] as const;

  for (const locale of supportedLocales.filter((candidate) => candidate !== 'en')) {
    const strings = getStrings(locale);
    for (const key of criticalKeys) {
      assert.notEqual(strings[key], english[key], `${locale}.${key} must not fall back to English`);
    }
  }
});

test('locale resolution supports common BCP 47 variants and falls back to English', () => {
  assert.equal(resolveLocale('zh-Hans'), 'zh-cn');
  assert.equal(resolveLocale('zh-SG'), 'zh-cn');
  assert.equal(resolveLocale('zh-Hant'), 'zh-tw');
  assert.equal(resolveLocale('zh-HK'), 'zh-tw');
  assert.equal(resolveLocale('en-US'), 'en');
  assert.equal(resolveLocale('unsupported'), 'en');
  assert.strictEqual(getStrings('unsupported'), getStrings('en'));
});

test('every package locale has the complete English key set with matching placeholders', () => {
  const load = (locale: typeof supportedLocales[number]): Record<string, string> => {
    const suffix = locale === 'en' ? '' : `.${locale}`;
    return JSON.parse(
      readFileSync(path.resolve(__dirname, `../../../package.nls${suffix}.json`), 'utf8'),
    ) as Record<string, string>;
  };
  const english = load('en');
  const englishKeys = Object.keys(english).sort();
  const placeholders = (value: string): string[] => Array.from(value.matchAll(/\{\d+\}/g), (match) => match[0]).sort();

  for (const locale of supportedLocales) {
    const messages = load(locale);
    assert.deepEqual(Object.keys(messages).sort(), englishKeys, `${locale} package NLS keys must match English`);
    for (const key of englishKeys) {
      assert.ok(messages[key]?.trim(), `${locale}.${key} must not be empty`);
      assert.deepEqual(
        placeholders(messages[key]!),
        placeholders(english[key]!),
        `${locale}.${key} package placeholders must match English`,
      );
    }
  }
});
