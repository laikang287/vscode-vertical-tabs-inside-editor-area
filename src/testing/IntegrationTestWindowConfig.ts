export interface IntegrationTestWindowConfig {
  readonly enabled: boolean;
  readonly preventFocus: boolean;
  readonly display: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const defaultIntegrationTestWindowConfig: IntegrationTestWindowConfig = {
  enabled: true,
  preventFocus: true,
  display: 'auto',
  x: 24,
  y: 24,
  width: 1280,
  height: 800,
};

const knownProperties = new Set<keyof IntegrationTestWindowConfig>([
  'enabled',
  'preventFocus',
  'display',
  'x',
  'y',
  'width',
  'height',
]);

export function parseIntegrationTestWindowConfig(value: unknown): IntegrationTestWindowConfig {
  if (!isRecord(value)) {
    throw new Error('测试窗口配置必须是 JSON 对象。');
  }

  const unknownProperties = Object.keys(value).filter(
    (property) => !knownProperties.has(property as keyof IntegrationTestWindowConfig),
  );
  if (unknownProperties.length > 0) {
    throw new Error(`测试窗口配置包含未知字段：${unknownProperties.join(', ')}。`);
  }

  const config = {
    ...defaultIntegrationTestWindowConfig,
    ...value,
  };

  assertBoolean(config.enabled, 'enabled');
  assertBoolean(config.preventFocus, 'preventFocus');
  if (typeof config.display !== 'string' || config.display.trim().length === 0) {
    throw new Error('测试窗口配置 display 必须是非空字符串。');
  }
  assertNonNegativeInteger(config.x, 'x');
  assertNonNegativeInteger(config.y, 'y');
  assertIntegerAtLeast(config.width, 'width', 640);
  assertIntegerAtLeast(config.height, 'height', 480);

  return {
    enabled: config.enabled,
    preventFocus: config.preventFocus,
    display: config.display.trim(),
    x: config.x,
    y: config.y,
    width: config.width,
    height: config.height,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertBoolean(value: unknown, property: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`测试窗口配置 ${property} 必须是布尔值。`);
  }
}

function assertNonNegativeInteger(value: unknown, property: string): asserts value is number {
  assertIntegerAtLeast(value, property, 0);
}

function assertIntegerAtLeast(value: unknown, property: string, minimum: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`测试窗口配置 ${property} 必须是大于或等于 ${minimum} 的整数。`);
  }
}
