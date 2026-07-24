import type { ProductIconName, TabInputKind, TabVisualIcon } from '../webview/messages';

export type SetiThemeVariant = 'dark' | 'light' | 'highContrast';

export interface SetiIconRequest {
  readonly label: string;
  readonly resourcePath?: string;
  readonly languageId?: string;
  readonly inputKind: TabInputKind;
}

interface IconDefinition {
  readonly fontCharacter: string;
  readonly fontColor?: string;
  readonly fontSize?: string;
}

interface IconAssociations {
  readonly file?: string;
  readonly fileNames: ReadonlyMap<string, string>;
  readonly fileExtensions: ReadonlyMap<string, string>;
  readonly languageIds: ReadonlyMap<string, string>;
}

interface ParsedTheme {
  readonly definitions: ReadonlyMap<string, IconDefinition>;
  readonly associations: IconAssociations;
}

const EMPTY_ASSOCIATIONS: IconAssociations = {
  fileNames: new Map(),
  fileExtensions: new Map(),
  languageIds: new Map(),
};

export class SetiIconResolver {
  private readonly theme: ParsedTheme;

  constructor(value: unknown, variant: SetiThemeVariant) {
    this.theme = parseTheme(value, variant);
  }

  resolve(request: SetiIconRequest): TabVisualIcon {
    if (request.inputKind === 'terminal') return codicon('terminal');
    if (request.inputKind === 'webview') return codicon(webviewIcon(request.label));
    if (request.inputKind === 'unknown') return codicon('symbol-misc');

    const iconId = resolveAssociation(this.theme.associations, request);
    const definition = iconId ? this.theme.definitions.get(iconId) : undefined;
    if (definition) {
      return {
        kind: 'seti',
        fontCharacter: definition.fontCharacter,
        ...(definition.fontColor ? { fontColor: definition.fontColor } : {}),
        ...(definition.fontSize ? { fontSize: definition.fontSize } : {}),
      };
    }
    return codicon(fallbackProductIcon(request.inputKind));
  }
}

export function fallbackTabVisualIcon(inputKind: TabInputKind, label = ''): TabVisualIcon {
  if (inputKind === 'webview') return codicon(webviewIcon(label));
  return codicon(fallbackProductIcon(inputKind));
}

function parseTheme(value: unknown, variant: SetiThemeVariant): ParsedTheme {
  if (!isRecord(value)) return { definitions: new Map(), associations: EMPTY_ASSOCIATIONS };
  const definitions = parseDefinitions(value.iconDefinitions);
  const base = parseAssociations(value);
  const variantValue = variant === 'light' ? value.light : variant === 'highContrast' ? value.highContrast : undefined;
  const overrides = parseAssociations(variantValue);
  return {
    definitions,
    associations: mergeAssociations(base, overrides),
  };
}

function parseDefinitions(value: unknown): ReadonlyMap<string, IconDefinition> {
  if (!isRecord(value)) return new Map();
  const result = new Map<string, IconDefinition>();
  for (const [id, candidate] of Object.entries(value)) {
    if (!isRecord(candidate) || !isFontCharacter(candidate.fontCharacter)) continue;
    const fontColor = isFontColor(candidate.fontColor) ? candidate.fontColor : undefined;
    const fontSize = isFontSize(candidate.fontSize) ? candidate.fontSize : undefined;
    result.set(id, {
      fontCharacter: candidate.fontCharacter,
      ...(fontColor ? { fontColor } : {}),
      ...(fontSize ? { fontSize } : {}),
    });
  }
  return result;
}

function parseAssociations(value: unknown): IconAssociations {
  if (!isRecord(value)) return EMPTY_ASSOCIATIONS;
  return {
    ...(typeof value.file === 'string' ? { file: value.file } : {}),
    fileNames: parseAssociationMap(value.fileNames),
    fileExtensions: parseAssociationMap(value.fileExtensions),
    languageIds: parseAssociationMap(value.languageIds),
  };
}

function parseAssociationMap(value: unknown): ReadonlyMap<string, string> {
  if (!isRecord(value)) return new Map();
  const result = new Map<string, string>();
  for (const [key, iconId] of Object.entries(value)) {
    if (typeof iconId === 'string' && iconId.length > 0) {
      result.set(normalizeAssociationKey(key), iconId);
    }
  }
  return result;
}

function mergeAssociations(base: IconAssociations, overrides: IconAssociations): IconAssociations {
  return {
    file: overrides.file ?? base.file,
    fileNames: new Map([...base.fileNames, ...overrides.fileNames]),
    fileExtensions: new Map([...base.fileExtensions, ...overrides.fileExtensions]),
    languageIds: new Map([...base.languageIds, ...overrides.languageIds]),
  };
}

function resolveAssociation(associations: IconAssociations, request: SetiIconRequest): string | undefined {
  const path = normalizePath(request.resourcePath ?? request.label);
  const segments = path.split('/').filter(Boolean);
  const fileName = (segments.at(-1) ?? request.label).toLowerCase();
  const parentName = segments.length > 1 ? segments.at(-2)?.toLowerCase() : undefined;

  const fileNameWithParent = parentName ? `${parentName}/${fileName}` : undefined;
  if (fileNameWithParent && associations.fileNames.has(fileNameWithParent)) {
    return associations.fileNames.get(fileNameWithParent);
  }
  if (associations.fileNames.has(fileName)) {
    return associations.fileNames.get(fileName);
  }

  const extensions = extensionCandidates(fileName);
  if (parentName) {
    for (const extension of extensions) {
      const match = associations.fileExtensions.get(`${parentName}/${extension}`);
      if (match) return match;
    }
  }
  for (const extension of extensions) {
    const match = associations.fileExtensions.get(extension);
    if (match) return match;
  }

  const languageId = request.languageId?.toLowerCase();
  if (languageId) {
    const match = associations.languageIds.get(languageId);
    if (match) return match;
  }
  return associations.file;
}

function extensionCandidates(fileName: string): readonly string[] {
  const parts = fileName.split('.');
  if (parts.length <= 1 || (parts.length === 2 && parts[0] === '')) return [];
  const result: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join('.');
    if (candidate) result.push(candidate);
  }
  return result;
}

function fallbackProductIcon(inputKind: TabInputKind): ProductIconName {
  if (inputKind === 'diff') return 'diff';
  if (inputKind === 'notebook' || inputKind === 'notebookDiff') return 'notebook';
  if (inputKind === 'terminal') return 'terminal';
  if (inputKind === 'webview') return 'preview';
  if (inputKind === 'unknown') return 'symbol-misc';
  return 'file';
}

function webviewIcon(label: string): ProductIconName {
  const normalized = label.toLowerCase();
  if (normalized.includes('setting') || normalized.includes('设置')) return 'settings-gear';
  if (normalized.includes('welcome') || normalized.includes('getting started') || normalized.includes('欢迎') || normalized.includes('入门')) return 'compass';
  return 'preview';
}

function codicon(name: ProductIconName): TabVisualIcon {
  return { kind: 'codicon', name };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function normalizeAssociationKey(value: string): string {
  return normalizePath(value).replace(/^\.?\/+/, '');
}

function isFontCharacter(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isFontColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value);
}

function isFontSize(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+)?(?:%|px|em|rem)$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
