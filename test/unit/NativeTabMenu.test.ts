import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNativeTabMenu, evaluateWhenClause, type NativeMenuContext, type ResolvedNativeMenuEntry } from '../../src/webview/NativeTabMenu';

function context(values: Readonly<Record<string, unknown>>): NativeMenuContext {
  return { get: (key) => values[key] };
}

function commandIds(entries: readonly ResolvedNativeMenuEntry[]): string[] {
  return entries.flatMap((entry) => entry.kind === 'action'
    ? [entry.command]
    : entry.kind === 'submenu'
      ? commandIds(entry.entries)
      : []);
}

test('evaluates supported when-clause operators and keeps unknown private context keys visible', () => {
  const values = context({
    resourceScheme: 'file',
    resourceExtname: '.ts',
    activeEditorIsDirty: false,
    supportedKinds: { typescript: true },
    resourceLangId: 'typescript',
  });

  assert.equal(evaluateWhenClause('resourceScheme == file && resourceExtname =~ /\\.tsx?$/', values), true);
  assert.equal(evaluateWhenClause('activeEditorIsDirty || resourceScheme != file', values), false);
  assert.equal(evaluateWhenClause('resourceLangId in supportedKinds', values), true);
  assert.equal(evaluateWhenClause('resourceLangId not in supportedKinds', values), false);
  assert.equal(evaluateWhenClause('private.extensionState && resourceScheme == file', values), undefined);
});

test('discovers extension submenus while removing duplicate close and pin groups', () => {
  const manifest = {
    id: 'publisher.example',
    packageJSON: {
      contributes: {
        commands: [
          { command: 'example.open', title: 'Open Example' },
          { command: 'example.disabled', title: 'Disabled Example', enablement: 'activeEditorIsDirty' },
          { command: 'example.unknown', title: 'Private Context Example', enablement: 'example.privateEnabled' },
          { command: 'example.child', title: 'Child Action' },
          { command: 'workbench.action.closeActiveEditor', title: 'Duplicate Close' },
          { command: 'workbench.action.pinEditor', title: 'Duplicate Pin' },
        ],
        submenus: [{ id: 'example.submenu', label: 'Example Tools' }],
        menus: {
          'editor/title/context': [
            { command: 'example.open', group: 'navigation@2', when: 'resourceScheme == file' },
            { command: 'example.disabled', group: '4_tools@1' },
            { command: 'example.unknown', group: '4_tools@2', when: 'example.privateVisible' },
            { submenu: 'example.submenu', group: '5_more@1' },
            { command: 'workbench.action.closeActiveEditor', group: '1_close@1' },
            { command: 'workbench.action.pinEditor', group: '3_preview@1' },
          ],
          'example.submenu': [
            { command: 'example.child', group: 'navigation@1' },
            { submenu: 'example.submenu', group: '9_cycle@1' },
          ],
        },
      },
    },
  };
  const available = new Set([
    'example.open',
    'example.disabled',
    'example.unknown',
    'example.child',
    'workbench.action.closeActiveEditor',
    'workbench.action.pinEditor',
  ]);

  const menu = buildNativeTabMenu([manifest], context({
    resourceScheme: 'file',
    activeEditorIsDirty: false,
  }), available);
  const commands = commandIds(menu);

  assert.deepEqual(commands, ['example.open', 'example.disabled', 'example.unknown', 'example.child']);
  assert.equal(commands.includes('workbench.action.closeActiveEditor'), false);
  assert.equal(commands.includes('workbench.action.pinEditor'), false);
  const disabled = menu.flatMap((entry) => entry.kind === 'action' ? [entry] : []).find((entry) => entry.command === 'example.disabled');
  const unknown = menu.flatMap((entry) => entry.kind === 'action' ? [entry] : []).find((entry) => entry.command === 'example.unknown');
  assert.equal(disabled?.enabled, false);
  assert.equal(unknown?.enabled, true);
  assert.equal(menu.some((entry) => entry.kind === 'submenu' && entry.label === 'Example Tools'), true);
  assert.equal(menu.some((entry) => entry.kind === 'separator'), true);
});

test('hides false contributions, unavailable commands, empty submenus, and submenu cycles', () => {
  const manifest = {
    id: 'publisher.filtered',
    packageJSON: {
      contributes: {
        commands: [
          { command: 'filtered.false', title: 'False' },
          { command: 'filtered.missing', title: 'Missing' },
        ],
        submenus: [{ id: 'filtered.empty', label: 'Empty' }],
        menus: {
          'editor/title/context': [
            { command: 'filtered.false', when: 'resourceScheme == untitled' },
            { command: 'filtered.missing' },
            { submenu: 'filtered.empty' },
          ],
          'filtered.empty': [{ submenu: 'filtered.empty' }],
        },
      },
    },
  };

  assert.deepEqual(buildNativeTabMenu([manifest], context({ resourceScheme: 'file' }), new Set()), []);
});
