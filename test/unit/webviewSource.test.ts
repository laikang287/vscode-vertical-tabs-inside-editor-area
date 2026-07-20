import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('context menu close actions dismiss the menu after posting', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /actionButton\('关闭其他标签', '关闭其他标签', 'closeOthers', tab\.target, true\)/);
  assert.match(source, /actionButton\('关闭下侧标签', '关闭下侧标签', 'closeBelow', tab\.target, true\)/);
  assert.match(source, /if \(dismissAfterClick\) dismissContextMenu\(\)/);
});

test('webview exposes grouping, sorting, bulk close, pinning, and drag messages', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /setGroupMode/);
  assert.match(source, /setSortMode/);
  assert.match(source, /closeAll/);
  assert.match(source, /pinTab/);
  assert.match(source, /unpinTab/);
  assert.match(source, /moveTab/);
  assert.match(source, /createGroupFromTabs/);
});

test('webview retries the initial snapshot request while it is still loading', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /requestInitialSnapshot\('ready'\)/);
  assert.match(source, /requestInitialSnapshot\('requestRefresh'\)/);
  assert.match(source, /refreshAttempts < 5/);
});

test('extension snapshot mtime lookup has a timeout', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /INPUT_MTIME_TIMEOUT_MS = 250/);
  assert.match(source, /withTimeout\(vscode\.workspace\.fs\.stat\(uri\), INPUT_MTIME_TIMEOUT_MS\)/);
});
