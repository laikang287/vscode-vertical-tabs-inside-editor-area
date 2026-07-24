import * as assert from 'node:assert';
import { test } from 'node:test';
import {
  defaultIntegrationTestWindowConfig,
  parseIntegrationTestWindowConfig,
} from '../../src/testing/IntegrationTestWindowConfig';

test('integration test window config supplies safe defaults', () => {
  assert.deepEqual(parseIntegrationTestWindowConfig({}), defaultIntegrationTestWindowConfig);
});

test('integration test window config accepts an explicit display and rectangle', () => {
  assert.deepEqual(parseIntegrationTestWindowConfig({
    enabled: true,
    preventFocus: true,
    display: ' DISPLAY3 ',
    x: 24,
    y: 48,
    width: 1600,
    height: 900,
  }), {
    enabled: true,
    preventFocus: true,
    display: 'DISPLAY3',
    x: 24,
    y: 48,
    width: 1600,
    height: 900,
  });
});

test('integration test window config accepts automatic display selection', () => {
  assert.equal(parseIntegrationTestWindowConfig({ display: ' AUTO ' }).display, 'AUTO');
});

test('integration test window config rejects invalid or unknown values', () => {
  assert.throws(
    () => parseIntegrationTestWindowConfig({ display: '' }),
    /display 必须是非空字符串/,
  );
  assert.throws(
    () => parseIntegrationTestWindowConfig({ x: -1 }),
    /x 必须是大于或等于 0 的整数/,
  );
  assert.throws(
    () => parseIntegrationTestWindowConfig({ width: 639 }),
    /width 必须是大于或等于 640 的整数/,
  );
  assert.throws(
    () => parseIntegrationTestWindowConfig({ preventFocus: 'yes' }),
    /preventFocus 必须是布尔值/,
  );
  assert.throws(
    () => parseIntegrationTestWindowConfig({ unexpected: true }),
    /未知字段：unexpected/,
  );
});
