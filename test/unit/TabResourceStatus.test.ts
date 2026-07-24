import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyTabResourceStatus,
  matchReadonlyPatterns,
  resolveCachedResourceMetadata,
} from '../../src/tabs/TabResourceStatus';

const writableDefaults = {
  schemeWritable: true,
  readonlyFromPermissions: true,
  readonlyPermission: false,
  readonlyIncluded: false,
  readonlyExcluded: false,
} as const;

test('classifies only explicit resource failures and gives them precedence over readonly hints', () => {
  assert.equal(classifyTabResourceStatus({ ...writableDefaults, errorCode: 'FileNotFound', readonlyIncluded: true }), 'missing');
  assert.equal(classifyTabResourceStatus({ ...writableDefaults, errorCode: 'NoPermissions' }), 'noPermissions');
  assert.equal(classifyTabResourceStatus({ ...writableDefaults, errorCode: 'Unavailable' }), 'unavailable');
  assert.equal(classifyTabResourceStatus({ ...writableDefaults, errorCode: 'Unknown' }), undefined);
  assert.equal(classifyTabResourceStatus({ ...writableDefaults }), undefined);
});

test('classifies readonly file systems, enabled include patterns, and permission bitmasks', () => {
  assert.equal(classifyTabResourceStatus({ ...writableDefaults, schemeWritable: false }), 'readonly');
  assert.equal(classifyTabResourceStatus({ ...writableDefaults, readonlyIncluded: true }), 'readonly');
  assert.equal(classifyTabResourceStatus({
    ...writableDefaults,
    readonlyPermission: true,
  }), 'readonly');
});

test('readonly excludes cancel include rules while permission detection follows its setting', () => {
  assert.equal(classifyTabResourceStatus({
    ...writableDefaults,
    readonlyIncluded: true,
    readonlyExcluded: true,
  }), undefined);
  assert.equal(classifyTabResourceStatus({
    ...writableDefaults,
    readonlyFromPermissions: false,
    readonlyPermission: true,
  }), undefined);
  assert.equal(classifyTabResourceStatus({
    ...writableDefaults,
    readonlyIncluded: true,
    readonlyExcluded: true,
    readonlyPermission: true,
  }), 'readonly');
});

test('matches enabled readonly globs against normalized workspace-relative paths', () => {
  assert.deepEqual(matchReadonlyPatterns(
    'vendor\\generated\\index.ts',
    { 'vendor/**': true, '**/*.md': false },
    { '**/editable/**': true },
  ), { included: true, excluded: false });
  assert.deepEqual(matchReadonlyPatterns(
    'vendor/editable/index.ts',
    { 'vendor/**': true },
    { '**/editable/**': true },
  ), { included: true, excluded: true });
  assert.deepEqual(matchReadonlyPatterns(
    'SRC/GENERATED.TS',
    { 'src/*.ts': true },
    undefined,
    true,
  ), { included: true, excluded: false });
});

test('deduplicates resource metadata loads by URI key within a snapshot', async () => {
  const cache = new Map<string, Promise<{ readonly mtime: number }>>();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return { mtime: 42 };
  };

  const first = resolveCachedResourceMetadata(cache, 'file:///workspace/a.ts', loader);
  const duplicate = resolveCachedResourceMetadata(cache, 'file:///workspace/a.ts', loader);
  const other = resolveCachedResourceMetadata(cache, 'file:///workspace/b.ts', loader);

  assert.equal(first, duplicate);
  assert.deepEqual(await Promise.all([first, duplicate, other]), [{ mtime: 42 }, { mtime: 42 }, { mtime: 42 }]);
  assert.equal(loads, 2);
});
