import assert from 'node:assert/strict';
import test from 'node:test';
import { SetiIconResolver } from '../../src/icons/SetiIconResolver';

const theme = {
  iconDefinitions: {
    file: { fontCharacter: '\uE001', fontColor: '#111111' },
    name: { fontCharacter: '\uE002', fontColor: '#222222' },
    parentName: { fontCharacter: '\uE003', fontColor: '#333333' },
    parentExtension: { fontCharacter: '\uE004', fontColor: '#444444' },
    multiExtension: { fontCharacter: '\uE005', fontColor: '#555555' },
    extension: { fontCharacter: '\uE006', fontColor: '#666666' },
    language: { fontCharacter: '\uE007', fontColor: '#777777' },
    lightExtension: { fontCharacter: '\uE008', fontColor: '#888888', fontSize: '140%' },
    highContrastFile: { fontCharacter: '\uE009', fontColor: '#ffffff' },
  },
  file: 'file',
  fileNames: {
    'special.ts': 'name',
    'src/special.ts': 'parentName',
  },
  fileExtensions: {
    'types/ts': 'parentExtension',
    'd.ts': 'multiExtension',
    ts: 'extension',
  },
  languageIds: {
    typescript: 'language',
  },
  light: {
    fileExtensions: {
      ts: 'lightExtension',
    },
  },
  highContrast: {
    file: 'highContrastFile',
  },
};

test('Seti icon resolution follows official filename, parent, extension, language, and default precedence', () => {
  const resolver = new SetiIconResolver(theme, 'dark');
  assert.deepEqual(resolve(resolver, 'src/special.ts'), { kind: 'seti', fontCharacter: '\uE003', fontColor: '#333333' });
  assert.deepEqual(resolve(resolver, 'other/special.ts'), { kind: 'seti', fontCharacter: '\uE002', fontColor: '#222222' });
  assert.deepEqual(resolve(resolver, 'types/model.ts'), { kind: 'seti', fontCharacter: '\uE004', fontColor: '#444444' });
  assert.deepEqual(resolve(resolver, 'src/model.d.ts'), { kind: 'seti', fontCharacter: '\uE005', fontColor: '#555555' });
  assert.deepEqual(resolve(resolver, 'src/model.ts'), { kind: 'seti', fontCharacter: '\uE006', fontColor: '#666666' });
  assert.deepEqual(resolve(resolver, 'README', 'typescript'), { kind: 'seti', fontCharacter: '\uE007', fontColor: '#777777' });
  assert.deepEqual(resolve(resolver, 'README'), { kind: 'seti', fontCharacter: '\uE001', fontColor: '#111111' });
});

test('Seti icon resolution merges light and high contrast theme variants', () => {
  const light = new SetiIconResolver(theme, 'light');
  assert.deepEqual(resolve(light, 'src/model.ts'), { kind: 'seti', fontCharacter: '\uE008', fontColor: '#888888', fontSize: '140%' });

  const highContrast = new SetiIconResolver(theme, 'highContrast');
  assert.deepEqual(resolve(highContrast, 'README'), { kind: 'seti', fontCharacter: '\uE009', fontColor: '#ffffff' });
});

test('Seti icon resolution falls back to safe product icons for unavailable or non-file editors', () => {
  const resolver = new SetiIconResolver({ file: 'missing', iconDefinitions: {} }, 'dark');
  assert.deepEqual(resolve(resolver, 'file.ts'), { kind: 'codicon', name: 'file' });
  assert.deepEqual(resolver.resolve({ label: 'Terminal', inputKind: 'terminal' }), { kind: 'codicon', name: 'terminal' });
  assert.deepEqual(resolver.resolve({ label: 'Settings', inputKind: 'webview' }), { kind: 'codicon', name: 'settings-gear' });
  assert.deepEqual(resolver.resolve({ label: 'Getting Started', inputKind: 'webview' }), { kind: 'codicon', name: 'compass' });
  assert.deepEqual(resolver.resolve({ label: 'Extension View', inputKind: 'webview' }), { kind: 'codicon', name: 'preview' });
  assert.deepEqual(resolver.resolve({ label: 'Unknown', inputKind: 'unknown' }), { kind: 'codicon', name: 'symbol-misc' });
});

test('Seti icon definitions reject unsafe visual values without breaking rendering', () => {
  const resolver = new SetiIconResolver({
    file: 'unsafe',
    iconDefinitions: {
      unsafe: { fontCharacter: '\uE010', fontColor: 'url(javascript:alert(1))', fontSize: 'calc(1px)' },
    },
  }, 'dark');
  assert.deepEqual(resolve(resolver, 'file.ts'), { kind: 'seti', fontCharacter: '\uE010' });
});

function resolve(resolver: SetiIconResolver, resourcePath: string, languageId?: string) {
  return resolver.resolve({
    label: resourcePath.split('/').at(-1) ?? resourcePath,
    resourcePath,
    languageId,
    inputKind: 'text',
  });
}
