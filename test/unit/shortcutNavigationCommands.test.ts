import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const navigationCommands = [
  'verticalTabs.previousInGroup',
  'verticalTabs.nextInGroup',
  'verticalTabs.previousAcrossGroups',
  'verticalTabs.nextAcrossGroups',
] as const;
const removedCommands = [
  'verticalTabs.previous',
  'verticalTabs.next',
  'verticalTabs.previousInGroupOnRelease',
  'verticalTabs.nextInGroupOnRelease',
  'verticalTabs.previousAcrossGroupsOnRelease',
  'verticalTabs.nextAcrossGroupsOnRelease',
] as const;

test('precise navigation commands use concise configurable names and remain unbound by default', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      keybindings: Array<{ command: string }>;
      menus: { commandPalette: Array<{ command: string; when: string }> };
    };
  };

  for (const command of navigationCommands) {
    const suffix = command.slice('verticalTabs.'.length);
    assert.deepEqual(
      manifest.contributes.commands.find((entry) => entry.command === command),
      { command, title: `%verticalTabs.command.${suffix}%` },
    );
    assert.ok(!manifest.contributes.keybindings.some((entry) => entry.command === command));
    assert.deepEqual(
      manifest.contributes.menus.commandPalette.find((entry) => entry.command === command),
      { command, when: 'false' },
    );
  }
  for (const command of removedCommands) {
    assert.ok(!manifest.contributes.commands.some((entry) => entry.command === command));
  }
});

test('every supported package locale includes only the concise navigation command titles', () => {
  for (const locale of ['en', 'zh-cn', 'zh-tw', 'ja', 'ko', 'de', 'fr', 'es', 'pt-br', 'ru']) {
    const suffix = locale === 'en' ? '' : `.${locale}`;
    const messages = JSON.parse(
      readFileSync(path.resolve(__dirname, `../../../package.nls${suffix}.json`), 'utf8'),
    ) as Record<string, string>;

    for (const command of navigationCommands) {
      const key = `verticalTabs.command.${command.slice('verticalTabs.'.length)}`;
      assert.ok(messages[key]?.trim(), `${locale}.${key} must be localized`);
    }
    assert.ok(!Object.keys(messages).some((key) => key.includes('OnRelease')));
  }
});

test('release-aware navigation uses validated Webview key-up messages without a commit timeout', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(panelSource, /armShortcutReleaseCapture/);
  assert.match(panelSource, /completeShortcutReleaseNavigation/);
  assert.match(panelSource, /SHORTCUT_RELEASE_SAFETY_TIMEOUT_MS/);
  assert.match(panelSource, /cancelShortcutReleaseNavigation\('safetyTimeout', true\)/);
  assert.doesNotMatch(panelSource, /SHORTCUT_RELEASE_SAFETY_TIMEOUT_MS[\s\S]{0,500}commitShortcutNavigation/);
  assert.match(webviewSource, /window\.addEventListener\('keyup', handleShortcutReleaseKeyUp, true\)/);
  assert.match(webviewSource, /type: 'shortcutReleaseComplete'/);
});

test('transient Webview blur preserves the preview and only VS Code window blur cancels the session', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(
    webviewSource,
    /window\.addEventListener\('blur', \(\) => \{\s*dismissContextMenu\(\);\s*\}\);/,
  );
  assert.doesNotMatch(webviewSource, /cancelShortcutReleaseCapture\('blur'\)/);
  assert.match(panelSource, /vscode\.window\.onDidChangeWindowState/);
  assert.match(panelSource, /cancelShortcutReleaseNavigation\('windowBlur', true\)/);
});
