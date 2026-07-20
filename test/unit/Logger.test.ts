import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_LOG_LEVEL, LogLevel, Logger } from '../../src/logging/Logger';

test('uses the hard-coded debug level and filters trace messages', () => {
  const lines: string[] = [];
  const logger = new Logger({ appendLine: (value) => lines.push(value) }, ACTIVE_LOG_LEVEL, () => new Date('2026-07-20T00:00:00.000Z'));

  logger.trace('trace details');
  logger.debug('layout started', { ratio: 0.2 });
  logger.info('layout complete');

  assert.equal(ACTIVE_LOG_LEVEL, LogLevel.Debug);
  assert.deepEqual(lines, [
    '2026-07-20T00:00:00.000Z [DEBUG] layout started | {"ratio":0.2}',
    '2026-07-20T00:00:00.000Z [INFO] layout complete',
  ]);
});

test('supports warn, error and off levels with error details', () => {
  const lines: string[] = [];
  const now = () => new Date('2026-07-20T00:00:00.000Z');
  const warnLogger = new Logger({ appendLine: (value) => lines.push(value) }, LogLevel.Warn, now);
  warnLogger.info('hidden');
  warnLogger.warn('retry exhausted', { attempts: 3 });
  warnLogger.error('layout failed', new Error('command unavailable'));

  const offLogger = new Logger({ appendLine: (value) => lines.push(value) }, LogLevel.Off, now);
  offLogger.error('hidden too');

  assert.equal(lines.length, 2);
  assert.match(lines[0], /\[WARN\] retry exhausted \| \{"attempts":3\}$/);
  assert.match(lines[1], /\[ERROR\] layout failed \| Error: command unavailable/);
});
