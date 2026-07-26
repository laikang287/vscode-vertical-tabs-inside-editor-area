import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  calculateScrollAnchorRestoration,
  isWithinNaturalScrollRange,
} from '../../src/webview/scrollAnchor';

test('keeps a stable item at the same viewport offset after a normal rerender', () => {
  assert.deepEqual(
    calculateScrollAnchorRestoration({
      currentScrollTop: 420,
      anchorOffsetBefore: 84,
      anchorOffsetAfter: 84,
      scrollHeight: 1_400,
      clientHeight: 600,
    }),
    { scrollTop: 420, trailingSpace: 0 },
  );
});

test('compensates for content changes above the stable item', () => {
  assert.deepEqual(
    calculateScrollAnchorRestoration({
      currentScrollTop: 300,
      anchorOffsetBefore: 120,
      anchorOffsetAfter: 70,
      scrollHeight: 1_400,
      clientHeight: 600,
    }),
    { scrollTop: 250, trailingSpace: 0 },
  );
});

test('supplies trailing space when a shorter list clamps the previous position', () => {
  assert.deepEqual(
    calculateScrollAnchorRestoration({
      currentScrollTop: 300,
      anchorOffsetBefore: 100,
      anchorOffsetAfter: 600,
      scrollHeight: 900,
      clientHeight: 600,
    }),
    { scrollTop: 800, trailingSpace: 500 },
  );
});

test('never requests a negative scroll offset', () => {
  assert.deepEqual(
    calculateScrollAnchorRestoration({
      currentScrollTop: 20,
      anchorOffsetBefore: 180,
      anchorOffsetAfter: 40,
      scrollHeight: 500,
      clientHeight: 600,
    }),
    { scrollTop: 0, trailingSpace: 0 },
  );
});

test('removes trailing compensation only after scrolling into the natural range', () => {
  assert.equal(isWithinNaturalScrollRange(800, 1_400, 600, 500), false);
  assert.equal(isWithinNaturalScrollRange(301, 1_400, 600, 500), true);
  assert.equal(isWithinNaturalScrollRange(800, 1_900, 600, 500), true);
});

test('webview rebuilds atomically and restores a preferred group scroll anchor', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /const nextTree = document\.createDocumentFragment\(\)/);
  assert.match(source, /appendDisplayGroup\(nextTree, resultGroup\.group, resultGroup\.autoExpand\)/);
  assert.match(source, /groups\.replaceChildren\(nextTree\)/);
  assert.doesNotMatch(source, /groups\.replaceChildren\(\);/);
  assert.match(source, /renderCurrentTabs\(\{ preferredFocusKey: treeFocusKeyForGroup\(group\) \}\)/);
  assert.match(source, /captureTreeScrollAnchor\(options\.preferredFocusKey\)/);
  assert.match(source, /calculateScrollAnchorRestoration\(\{/);
  assert.match(source, /spacer\.className = 'scroll-anchor-spacer'/);
  assert.match(source, /clearScrollAnchorCompensationWhenSafe/);
  assert.match(source, /renderCurrentTabs\(\{ preserveScroll: followedTarget === undefined \}\)/);
  assert.match(style, /\.scroll-anchor-spacer \{[\s\S]+pointer-events: none;[\s\S]+width: 1px;/);
});
