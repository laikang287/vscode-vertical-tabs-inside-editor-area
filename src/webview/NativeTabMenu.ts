export type WhenResult = boolean | undefined;
export type NativeMenuInvocation = 'editor' | 'resource';

export interface NativeMenuContext {
  get(key: string): unknown | undefined;
}

export interface NativeMenuManifest {
  readonly id: string;
  readonly packageJSON: unknown;
}

export type ResolvedNativeMenuEntry =
  | { readonly kind: 'separator' }
  | {
    readonly kind: 'action';
    readonly label: string;
    readonly command: string;
    readonly enabled: boolean;
    readonly invocation: NativeMenuInvocation;
  }
  | { readonly kind: 'submenu'; readonly label: string; readonly entries: readonly ResolvedNativeMenuEntry[] };

interface MenuContribution {
  readonly command?: string;
  readonly submenu?: string;
  readonly group?: string;
  readonly when?: string;
}

interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly enablement?: string;
  readonly invocation: NativeMenuInvocation;
}

interface SubmenuContribution {
  readonly id: string;
  readonly label: string;
}

interface IndexedContribution {
  readonly contribution: MenuContribution;
  readonly sourceOrder: number;
}

interface ManifestIndex {
  readonly commands: Map<string, CommandContribution>;
  readonly submenus: Map<string, SubmenuContribution>;
  readonly menus: Map<string, IndexedContribution[]>;
}

const ROOT_MENU = 'editor/title/context';
const MAX_MENU_DEPTH = 8;
const MAX_MENU_ITEMS = 500;

const DUPLICATE_COMMANDS = new Set([
  'workbench.action.closeActiveEditor',
  'workbench.action.closeActivePinnedEditor',
  'workbench.action.closeOtherEditors',
  'workbench.action.closeEditorsToTheRight',
  'workbench.action.closeUnmodifiedEditors',
  'workbench.action.closeEditorsInGroup',
  'workbench.action.closeEditorsAndGroup',
  'workbench.action.closeGroup',
  'workbench.action.closeAllEditors',
  'workbench.action.keepEditor',
  'workbench.action.pinEditor',
  'workbench.action.unpinEditor',
]);

const EDITOR_SCOPED_COMMANDS = new Set([
  'workbench.action.reopenWithEditor',
  'workbench.action.splitEditor',
  'workbench.action.splitEditorUp',
  'workbench.action.splitEditorDown',
  'workbench.action.splitEditorLeft',
  'workbench.action.splitEditorRight',
  'workbench.action.moveEditorToAboveGroup',
  'workbench.action.moveEditorToBelowGroup',
  'workbench.action.moveEditorToLeftGroup',
  'workbench.action.moveEditorToRightGroup',
  'workbench.action.splitEditorInGroup',
  'workbench.action.joinEditorInGroup',
  'workbench.action.moveEditorToNewWindow',
  'workbench.action.copyEditorToNewWindow',
  'workbench.action.terminal.moveToTerminalPanel',
  'workbench.action.terminal.rename',
  'workbench.action.terminal.changeColor',
  'workbench.action.terminal.changeIcon',
  'workbench.action.terminal.sizeToContentWidth',
]);

export function buildNativeTabMenu(
  manifests: readonly NativeMenuManifest[],
  context: NativeMenuContext,
  availableCommands: ReadonlySet<string>,
  language = 'en',
): readonly ResolvedNativeMenuEntry[] {
  const index = indexManifests([coreMenuManifest(language), ...manifests]);
  let itemCount = 0;
  const build = (menuId: string, ancestors: ReadonlySet<string>, depth: number): readonly ResolvedNativeMenuEntry[] => {
    if (depth > MAX_MENU_DEPTH || ancestors.has(menuId) || itemCount >= MAX_MENU_ITEMS) return [];
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(menuId);
    const contributions = index.menus.get(menuId) ?? [];
    const grouped = new Map<string, Array<{ readonly entry: ResolvedNativeMenuEntry; readonly order: number; readonly sourceOrder: number }>>();
    for (const indexed of contributions) {
      if (itemCount >= MAX_MENU_ITEMS) break;
      const contribution = indexed.contribution;
      if (evaluateWhenClause(contribution.when, context) === false) continue;
      const group = contribution.group ?? '';
      if (isDuplicateGroup(group)) continue;
      let entry: ResolvedNativeMenuEntry | undefined;
      if (contribution.command) {
        if (DUPLICATE_COMMANDS.has(contribution.command) || !availableCommands.has(contribution.command)) continue;
        const command = index.commands.get(contribution.command);
        entry = {
          kind: 'action',
          command: contribution.command,
          label: command?.title ?? contribution.command,
          enabled: evaluateWhenClause(command?.enablement, context) !== false,
          invocation: command?.invocation ?? (EDITOR_SCOPED_COMMANDS.has(contribution.command) ? 'editor' : 'resource'),
        };
      } else if (contribution.submenu) {
        const submenu = index.submenus.get(contribution.submenu);
        const entries = build(contribution.submenu, nextAncestors, depth + 1);
        if (!submenu || entries.length === 0) continue;
        entry = { kind: 'submenu', label: submenu.label, entries };
      }
      if (!entry) continue;
      itemCount += 1;
      const groupInfo = parseGroup(group);
      const bucket = grouped.get(groupInfo.id) ?? [];
      bucket.push({ entry, order: groupInfo.order, sourceOrder: indexed.sourceOrder });
      grouped.set(groupInfo.id, bucket);
    }
    const result: ResolvedNativeMenuEntry[] = [];
    const groups = Array.from(grouped.entries()).sort(([left], [right]) => compareGroups(left, right));
    for (const [, entries] of groups) {
      const unique = new Set<string>();
      const sorted = entries.sort((left, right) => left.order - right.order || left.sourceOrder - right.sourceOrder);
      const visible = sorted.filter(({ entry }) => {
        const key = entry.kind === 'action'
          ? `action:${entry.command}`
          : entry.kind === 'submenu'
            ? `submenu:${entry.label}`
            : 'separator';
        if (unique.has(key)) return false;
        unique.add(key);
        return true;
      });
      if (visible.length === 0) continue;
      if (result.length > 0) result.push({ kind: 'separator' });
      result.push(...visible.map(({ entry }) => entry));
    }
    return result;
  };
  return trimSeparators(build(ROOT_MENU, new Set(), 0));
}

export function evaluateWhenClause(expression: string | undefined, context: NativeMenuContext): WhenResult {
  if (!expression?.trim()) return true;
  try {
    const parser = new WhenParser(tokenize(expression), context);
    const value = parser.parse();
    return value.known ? Boolean(value.value) : undefined;
  } catch {
    return undefined;
  }
}

function indexManifests(manifests: readonly NativeMenuManifest[]): ManifestIndex {
  const commands = new Map<string, CommandContribution>();
  const submenus = new Map<string, SubmenuContribution>();
  const menus = new Map<string, IndexedContribution[]>();
  let sourceOrder = 0;
  for (const manifest of manifests) {
    const packageJSON = asRecord(manifest.packageJSON);
    const contributes = asRecord(packageJSON?.contributes);
    for (const value of asArray(contributes?.commands)) {
      const command = asRecord(value);
      if (typeof command?.command !== 'string') continue;
      if (!commands.has(command.command)) {
        commands.set(command.command, {
          command: command.command,
          title: localizedText(command.title) ?? command.command,
          enablement: typeof command.enablement === 'string' ? command.enablement : undefined,
          invocation: command.invocation === 'editor' ? 'editor' : 'resource',
        });
      }
    }
    for (const value of asArray(contributes?.submenus)) {
      const submenu = asRecord(value);
      if (typeof submenu?.id !== 'string') continue;
      if (!submenus.has(submenu.id)) {
        submenus.set(submenu.id, {
          id: submenu.id,
          label: localizedText(submenu.label) ?? submenu.id,
        });
      }
    }
    const contributedMenus = asRecord(contributes?.menus);
    for (const [menuId, values] of Object.entries(contributedMenus ?? {})) {
      const bucket = menus.get(menuId) ?? [];
      for (const value of asArray(values)) {
        const menu = asRecord(value);
        if (!menu) continue;
        const command = typeof menu?.command === 'string' ? menu.command : undefined;
        const submenu = typeof menu?.submenu === 'string' ? menu.submenu : undefined;
        if (!command && !submenu) continue;
        bucket.push({
          contribution: {
            command,
            submenu,
            group: typeof menu.group === 'string' ? menu.group : undefined,
            when: typeof menu.when === 'string' ? menu.when : undefined,
          },
          sourceOrder,
        });
        sourceOrder += 1;
      }
      menus.set(menuId, bucket);
    }
  }
  return { commands, submenus, menus };
}

function coreMenuManifest(language: string): NativeMenuManifest {
  const zh = language.toLowerCase().startsWith('zh');
  const title = (english: string, chinese: string): string => zh ? chinese : english;
  const commands = [
    coreCommand('workbench.action.reopenWithEditor', title('Reopen Editor With...', '重新打开方式…')),
    coreCommand('workbench.action.splitEditor', title('Split Editor', '拆分编辑器')),
    coreCommand('workbench.action.splitEditorUp', title('Split Up', '向上拆分')),
    coreCommand('workbench.action.splitEditorDown', title('Split Down', '向下拆分')),
    coreCommand('workbench.action.splitEditorLeft', title('Split Left', '向左拆分')),
    coreCommand('workbench.action.splitEditorRight', title('Split Right', '向右拆分')),
    coreCommand('workbench.action.moveEditorToAboveGroup', title('Move into Previous Group', '移动到上方组')),
    coreCommand('workbench.action.moveEditorToBelowGroup', title('Move into Next Group', '移动到下方组')),
    coreCommand('workbench.action.moveEditorToLeftGroup', title('Move into Left Group', '移动到左侧组')),
    coreCommand('workbench.action.moveEditorToRightGroup', title('Move into Right Group', '移动到右侧组')),
    coreCommand('workbench.action.splitEditorInGroup', title('Split in Group', '在组内拆分')),
    coreCommand('workbench.action.joinEditorInGroup', title('Join in Group', '在组内合并')),
    coreCommand('workbench.action.moveEditorToNewWindow', title('Move into New Window', '移动到新窗口')),
    coreCommand('workbench.action.copyEditorToNewWindow', title('Copy into New Window', '复制到新窗口')),
    resourceCommand('copyFilePath', title('Copy Path', '复制路径')),
    resourceCommand('copyRelativeFilePath', title('Copy Relative Path', '复制相对路径')),
    resourceCommand('revealInExplorer', title('Reveal in File Explorer', '在文件资源管理器中显示')),
    resourceCommand('compareSelected', title('Compare with Selected', '与已选项进行比较')),
    coreCommand('workbench.action.terminal.moveToTerminalPanel', title('Move Terminal into Panel', '将终端移动到面板')),
    coreCommand('workbench.action.terminal.rename', title('Rename Terminal', '重命名终端')),
    coreCommand('workbench.action.terminal.changeColor', title('Change Terminal Color', '更改终端颜色')),
    coreCommand('workbench.action.terminal.changeIcon', title('Change Terminal Icon', '更改终端图标')),
    coreCommand('workbench.action.terminal.sizeToContentWidth', title('Size Terminal to Content Width', '使终端适应内容宽度')),
  ];
  const root = [
    menuCommand('workbench.action.reopenWithEditor', '2_open@1'),
    menuCommand('workbench.action.splitEditor', '4_split@1'),
    menuSubmenu('verticalTabs.native.splitMove', '4_split@2'),
    menuCommand('workbench.action.moveEditorToNewWindow', '5_move@1'),
    menuCommand('workbench.action.copyEditorToNewWindow', '5_move@2'),
    menuSubmenu('editor/title/context/share', '6_share@1'),
    menuCommand('copyFilePath', '7_copy@1', 'resourceScheme != untitled'),
    menuCommand('copyRelativeFilePath', '7_copy@2', 'resourceScheme != untitled'),
    menuCommand('revealInExplorer', '7_copy@3', 'isFileSystemResource'),
    menuCommand('compareSelected', '8_compare@1', 'resourceScheme == file'),
    menuCommand('workbench.action.terminal.moveToTerminalPanel', '9_terminal@1', 'terminalEditorFocus'),
    menuCommand('workbench.action.terminal.rename', '9_terminal@2', 'terminalEditorFocus'),
    menuCommand('workbench.action.terminal.changeColor', '9_terminal@3', 'terminalEditorFocus'),
    menuCommand('workbench.action.terminal.changeIcon', '9_terminal@4', 'terminalEditorFocus'),
    menuCommand('workbench.action.terminal.sizeToContentWidth', '9_terminal@5', 'terminalEditorFocus'),
  ];
  const split = [
    menuCommand('workbench.action.splitEditorUp', '1_split@1'),
    menuCommand('workbench.action.splitEditorDown', '1_split@2'),
    menuCommand('workbench.action.splitEditorLeft', '1_split@3'),
    menuCommand('workbench.action.splitEditorRight', '1_split@4'),
    menuCommand('workbench.action.moveEditorToAboveGroup', '2_move@1'),
    menuCommand('workbench.action.moveEditorToBelowGroup', '2_move@2'),
    menuCommand('workbench.action.moveEditorToLeftGroup', '2_move@3'),
    menuCommand('workbench.action.moveEditorToRightGroup', '2_move@4'),
    menuCommand('workbench.action.splitEditorInGroup', '3_group@1'),
    menuCommand('workbench.action.joinEditorInGroup', '3_group@2'),
  ];
  return {
    id: '__verticalTabsCore',
    packageJSON: {
      contributes: {
        commands,
        submenus: [
          { id: 'verticalTabs.native.splitMove', label: title('Split / Move', '拆分 / 移动') },
          { id: 'editor/title/context/share', label: title('Share', '共享') },
        ],
        menus: {
          [ROOT_MENU]: root,
          'verticalTabs.native.splitMove': split,
        },
      },
    },
  };
}

function coreCommand(command: string, title: string): Record<string, string> {
  return { command, title, invocation: 'editor' };
}

function resourceCommand(command: string, title: string): Record<string, string> {
  return { command, title, invocation: 'resource' };
}

function menuCommand(command: string, group: string, when?: string): Record<string, string> {
  return { command, group, ...(when ? { when } : {}) };
}

function menuSubmenu(submenu: string, group: string): Record<string, string> {
  return { submenu, group };
}

function localizedText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  const record = asRecord(value);
  return typeof record?.value === 'string' && record.value.length > 0
    ? record.value
    : typeof record?.original === 'string' && record.original.length > 0
      ? record.original
      : undefined;
}

function isDuplicateGroup(group: string): boolean {
  const id = parseGroup(group).id;
  return id === '1_close' || id.startsWith('1_close') || id === '3_preview' || id.startsWith('3_preview');
}

function parseGroup(group: string): { readonly id: string; readonly order: number } {
  const at = group.lastIndexOf('@');
  if (at < 0) return { id: group, order: Number.MAX_SAFE_INTEGER };
  const order = Number(group.slice(at + 1));
  return {
    id: group.slice(0, at),
    order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER,
  };
}

function compareGroups(left: string, right: string): number {
  if (left === 'navigation') return right === 'navigation' ? 0 : -1;
  if (right === 'navigation') return 1;
  if (left === '') return right === '' ? 0 : 1;
  if (right === '') return -1;
  return left.localeCompare(right);
}

function trimSeparators(entries: readonly ResolvedNativeMenuEntry[]): readonly ResolvedNativeMenuEntry[] {
  let start = 0;
  let end = entries.length;
  while (start < end && entries[start]?.kind === 'separator') start += 1;
  while (end > start && entries[end - 1]?.kind === 'separator') end -= 1;
  return entries.slice(start, end);
}

interface Token {
  readonly kind: 'word' | 'string' | 'regex' | 'operator' | 'leftParen' | 'rightParen';
  readonly value: string;
}

interface EvalValue {
  readonly known: boolean;
  readonly value?: unknown;
}

const UNKNOWN: EvalValue = { known: false };

class WhenParser {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly context: NativeMenuContext,
  ) {}

  parse(): EvalValue {
    const value = this.parseOr();
    if (this.index !== this.tokens.length) throw new Error('Unexpected token');
    return value;
  }

  private parseOr(): EvalValue {
    let left = this.parseAnd();
    while (this.matchOperator('||')) {
      left = orValue(left, this.parseAnd());
    }
    return left;
  }

  private parseAnd(): EvalValue {
    let left = this.parseUnary();
    while (this.matchOperator('&&')) {
      left = andValue(left, this.parseUnary());
    }
    return left;
  }

  private parseUnary(): EvalValue {
    if (this.matchOperator('!')) {
      const value = this.parseUnary();
      return value.known ? { known: true, value: !Boolean(value.value) } : UNKNOWN;
    }
    if (this.peek()?.kind === 'leftParen') {
      this.index += 1;
      const value = this.parseOr();
      if (this.peek()?.kind !== 'rightParen') throw new Error('Missing closing parenthesis');
      this.index += 1;
      return value;
    }
    return this.parseComparison();
  }

  private parseComparison(): EvalValue {
    const leftToken = this.consume();
    if (!leftToken || (leftToken.kind !== 'word' && leftToken.kind !== 'string')) throw new Error('Missing operand');
    const operator = this.comparisonOperator();
    if (!operator) return this.resolveLeft(leftToken);
    const rightToken = this.consume();
    if (!rightToken || rightToken.kind === 'operator' || rightToken.kind === 'leftParen' || rightToken.kind === 'rightParen') {
      throw new Error('Missing comparison operand');
    }
    const left = this.resolveLeft(leftToken);
    if (!left.known) return UNKNOWN;
    if (operator === 'in' || operator === 'not in') {
      const right = rightToken.kind === 'word' ? this.resolveContext(rightToken.value) : literalValue(rightToken);
      if (!right.known) return UNKNOWN;
      const contains = Array.isArray(right.value)
        ? right.value.includes(left.value)
        : asRecord(right.value)
          ? Object.prototype.hasOwnProperty.call(right.value, String(left.value))
          : false;
      return { known: true, value: operator === 'in' ? contains : !contains };
    }
    const right = literalValue(rightToken);
    if (!right.known) return UNKNOWN;
    return compareValues(left.value, right.value, operator);
  }

  private comparisonOperator(): string | undefined {
    const token = this.peek();
    if (!token) return undefined;
    if (token.kind === 'operator' && ['==', '===', '!=', '!==', '=~', '<', '<=', '>', '>='].includes(token.value)) {
      this.index += 1;
      return token.value;
    }
    if (token.kind === 'word' && token.value === 'in') {
      this.index += 1;
      return 'in';
    }
    if (token.kind === 'word' && token.value === 'not' && this.tokens[this.index + 1]?.kind === 'word' && this.tokens[this.index + 1]?.value === 'in') {
      this.index += 2;
      return 'not in';
    }
    return undefined;
  }

  private resolveLeft(token: Token): EvalValue {
    if (token.kind === 'string') return { known: true, value: token.value };
    if (token.value === 'true') return { known: true, value: true };
    if (token.value === 'false') return { known: true, value: false };
    return this.resolveContext(token.value);
  }

  private resolveContext(key: string): EvalValue {
    const value = this.context.get(key);
    return value === undefined ? UNKNOWN : { known: true, value };
  }

  private matchOperator(value: string): boolean {
    if (this.peek()?.kind !== 'operator' || this.peek()?.value !== value) return false;
    this.index += 1;
    return true;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(): Token | undefined {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}

function tokenize(expression: string): Token[] {
  const result: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '(' || char === ')') {
      result.push({ kind: char === '(' ? 'leftParen' : 'rightParen', value: char });
      index += 1;
      continue;
    }
    const operator = ['!==', '===', '&&', '||', '==', '!=', '=~', '<=', '>=', '!', '<', '>']
      .find((candidate) => expression.startsWith(candidate, index));
    if (operator) {
      result.push({ kind: 'operator', value: operator });
      index += operator.length;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      index += 1;
      while (index < expression.length && expression[index] !== quote) {
        if (expression[index] === '\\' && index + 1 < expression.length) index += 1;
        value += expression[index]!;
        index += 1;
      }
      if (expression[index] !== quote) throw new Error('Unterminated string');
      index += 1;
      result.push({ kind: 'string', value });
      continue;
    }
    if (char === '/') {
      let value = '/';
      index += 1;
      let escaped = false;
      while (index < expression.length) {
        const current = expression[index]!;
        value += current;
        index += 1;
        if (!escaped && current === '/') break;
        escaped = !escaped && current === '\\';
        if (current !== '\\') escaped = false;
      }
      while (index < expression.length && /[a-z]/i.test(expression[index]!)) {
        value += expression[index]!;
        index += 1;
      }
      result.push({ kind: 'regex', value });
      continue;
    }
    let value = '';
    while (index < expression.length && !/\s|[()!<>=&|]/.test(expression[index]!)) {
      value += expression[index]!;
      index += 1;
    }
    if (!value) throw new Error('Unsupported token');
    result.push({ kind: 'word', value });
  }
  return result;
}

function literalValue(token: Token): EvalValue {
  if (token.kind === 'regex') return { known: true, value: token.value };
  if (token.kind === 'string') return { known: true, value: token.value };
  if (token.value === 'true') return { known: true, value: true };
  if (token.value === 'false') return { known: true, value: false };
  if (token.value === 'null') return { known: true, value: null };
  const number = Number(token.value);
  return { known: true, value: token.value !== '' && Number.isFinite(number) ? number : token.value };
}

function compareValues(left: unknown, right: unknown, operator: string): EvalValue {
  if (operator === '=~') {
    if (typeof left !== 'string' || typeof right !== 'string' || right.length > 1000) return { known: true, value: false };
    const match = /^\/([\s\S]*)\/([a-z]*)$/i.exec(right);
    if (!match) return { known: true, value: false };
    try {
      return { known: true, value: new RegExp(match[1], match[2]).test(left) };
    } catch {
      return UNKNOWN;
    }
  }
  if (operator === '==' || operator === '===') return { known: true, value: left === right || String(left) === String(right) };
  if (operator === '!=' || operator === '!==') return { known: true, value: !(left === right || String(left) === String(right)) };
  if (operator === '<') return { known: true, value: Number(left) < Number(right) };
  if (operator === '<=') return { known: true, value: Number(left) <= Number(right) };
  if (operator === '>') return { known: true, value: Number(left) > Number(right) };
  if (operator === '>=') return { known: true, value: Number(left) >= Number(right) };
  return UNKNOWN;
}

function andValue(left: EvalValue, right: EvalValue): EvalValue {
  if ((left.known && !Boolean(left.value)) || (right.known && !Boolean(right.value))) return { known: true, value: false };
  if (left.known && right.known) return { known: true, value: Boolean(left.value) && Boolean(right.value) };
  return UNKNOWN;
}

function orValue(left: EvalValue, right: EvalValue): EvalValue {
  if ((left.known && Boolean(left.value)) || (right.known && Boolean(right.value))) return { known: true, value: true };
  if (left.known && right.known) return { known: true, value: false };
  return UNKNOWN;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
