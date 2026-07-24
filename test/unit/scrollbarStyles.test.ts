import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('vertical tabs keep scrolling while hiding the groups scrollbar', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');
  const panelSource = readFileSync(
    path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'),
    'utf8',
  );

  assert.match(
    style,
    /#groups \{[\s\S]+scrollbar-width: none;[\s\S]+overflow-y: auto;[\s\S]+#groups::-webkit-scrollbar \{[\s\S]+display: none;/,
  );
  assert.match(
    panelSource,
    /'#groups \{ flex: 1 1 auto; min-height: 0; overflow: auto; scrollbar-width: none; \}'/,
  );
  assert.match(panelSource, /'#groups::-webkit-scrollbar \{ display: none; \}'/);
});
