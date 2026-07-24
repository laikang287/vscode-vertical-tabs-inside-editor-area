import { minimatch } from 'minimatch';
import type { TabResourceStatus } from '../webview/messages';

export interface ResourceStatusInput {
  readonly schemeWritable: boolean | undefined;
  readonly errorCode?: string;
  readonly readonlyFromPermissions: boolean;
  readonly readonlyPermission: boolean;
  readonly readonlyIncluded: boolean;
  readonly readonlyExcluded: boolean;
}

export interface ReadonlyPatternMatch {
  readonly included: boolean;
  readonly excluded: boolean;
}

export function classifyTabResourceStatus(input: ResourceStatusInput): TabResourceStatus | undefined {
  if (input.errorCode === 'FileNotFound') return 'missing';
  if (input.errorCode === 'NoPermissions') return 'noPermissions';
  if (input.errorCode === 'Unavailable') return 'unavailable';

  if (input.schemeWritable === false) return 'readonly';
  if (input.readonlyIncluded && !input.readonlyExcluded) return 'readonly';
  if (input.readonlyFromPermissions && input.readonlyPermission) return 'readonly';
  return undefined;
}

export function matchReadonlyPatterns(
  resourcePath: string,
  include: Readonly<Record<string, unknown>> | undefined,
  exclude: Readonly<Record<string, unknown>> | undefined,
  nocase = false,
): ReadonlyPatternMatch {
  const normalizedPath = normalizeGlobPath(resourcePath);
  return {
    included: matchesEnabledPattern(normalizedPath, include, nocase),
    excluded: matchesEnabledPattern(normalizedPath, exclude, nocase),
  };
}

export function resolveCachedResourceMetadata<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = loader();
  cache.set(key, pending);
  return pending;
}

function matchesEnabledPattern(
  resourcePath: string,
  patterns: Readonly<Record<string, unknown>> | undefined,
  nocase: boolean,
): boolean {
  if (!patterns) return false;
  return Object.entries(patterns).some(([pattern, enabled]) => {
    if (enabled !== true || pattern.length === 0) return false;
    const normalizedPattern = normalizeGlobPath(pattern);
    return minimatch(resourcePath, normalizedPattern, {
      dot: true,
      nocase,
      nonegate: true,
      nocomment: true,
      windowsPathsNoEscape: true,
    }) || (normalizedPattern.startsWith('/') && minimatch(`/${resourcePath}`, normalizedPattern, {
      dot: true,
      nocase,
      nonegate: true,
      nocomment: true,
      windowsPathsNoEscape: true,
    }));
  });
}

function normalizeGlobPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}
