import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  buildNativeTabMenu,
  type NativeMenuContext,
  type NativeMenuInvocation,
  type NativeMenuManifest,
  type ResolvedNativeMenuEntry,
} from './NativeTabMenu';
import type { NativeContextMenuEntry } from './messages';

export interface NativeTabMenuAction {
  readonly command: string;
  readonly invocation: NativeMenuInvocation;
}

export class NativeTabMenuProvider implements vscode.Disposable {
  private readonly nonce = crypto.randomBytes(8).toString('hex');
  private readonly extensionChangeDisposable: vscode.Disposable;
  private manifests: readonly NativeMenuManifest[] | undefined;
  private actions = new Map<string, NativeTabMenuAction>();
  private generation = 0;

  constructor() {
    this.extensionChangeDisposable = vscode.extensions.onDidChange(() => {
      this.manifests = undefined;
      this.actions.clear();
      this.generation = (this.generation % Number.MAX_SAFE_INTEGER) + 1;
    });
  }

  async createMenu(tab: vscode.Tab, language: string): Promise<readonly NativeContextMenuEntry[]> {
    this.generation = (this.generation % Number.MAX_SAFE_INTEGER) + 1;
    const generation = this.generation;
    const availableCommands = new Set(await vscode.commands.getCommands(true));
    const resolved = buildNativeTabMenu(
      this.getManifests(),
      createContext(tab),
      availableCommands,
      language,
    );
    if (generation !== this.generation) return [];
    this.actions = new Map();
    let actionIndex = 0;
    const convert = (entries: readonly ResolvedNativeMenuEntry[]): NativeContextMenuEntry[] => {
      const result: NativeContextMenuEntry[] = [];
      for (const entry of entries) {
        if (entry.kind === 'separator') {
          result.push({ kind: 'separator' });
          continue;
        }
        if (entry.kind === 'submenu') {
          const children = convert(entry.entries);
          if (children.length > 0) result.push({ kind: 'submenu', label: entry.label, entries: children });
          continue;
        }
        actionIndex += 1;
        const actionId = `${this.nonce}_${generation}_${actionIndex}`;
        if (entry.enabled) {
          this.actions.set(actionId, { command: entry.command, invocation: entry.invocation });
        }
        result.push({
          kind: 'action',
          actionId,
          label: entry.label,
          enabled: entry.enabled,
        });
      }
      return result;
    };
    return convert(resolved);
  }

  resolveAction(actionId: string): NativeTabMenuAction | undefined {
    return this.actions.get(actionId);
  }

  dispose(): void {
    this.actions.clear();
    this.extensionChangeDisposable.dispose();
  }

  private getManifests(): readonly NativeMenuManifest[] {
    if (!this.manifests) {
      this.manifests = vscode.extensions.all.map((extension) => ({
        id: extension.id,
        packageJSON: extension.packageJSON as unknown,
      }));
    }
    return this.manifests;
  }
}

function createContext(tab: vscode.Tab): NativeMenuContext {
  const uri = inputUri(tab.input);
  const languageId = inputLanguageId(tab.input, uri);
  const values = new Map<string, unknown>([
    ['resource', uri],
    ['resourceUri', uri],
    ['resourceScheme', uri?.scheme],
    ['resourceFilename', uri ? path.posix.basename(uri.path) : undefined],
    ['resourceExtname', uri ? path.posix.extname(uri.path) : undefined],
    ['resourceDirname', uri ? path.posix.dirname(uri.path) : undefined],
    ['resourcePath', uri?.path],
    ['resourceLangId', languageId],
    ['editorLangId', languageId],
    ['isFileSystemResource', uri ? uri.scheme === 'file' || uri.scheme === 'vscode-remote' : false],
    ['activeEditorIsDirty', tab.isDirty],
    ['activeEditorIsPinned', tab.isPinned],
    ['activeEditorIsPreview', tab.isPreview],
    ['activeEditor', activeEditorId(tab.input)],
    ['terminalEditorFocus', tab.input instanceof vscode.TabInputTerminal],
    ['isWeb', vscode.env.uiKind === vscode.UIKind.Web],
    ['remoteName', vscode.env.remoteName ?? ''],
  ]);
  return {
    get(key: string): unknown | undefined {
      if (key.startsWith('config.')) {
        return vscode.workspace.getConfiguration().get(key.slice('config.'.length));
      }
      return values.get(key);
    },
  };
}

function inputUri(input: vscode.Tab['input']): vscode.Uri | undefined {
  return input instanceof vscode.TabInputText
    || input instanceof vscode.TabInputCustom
    || input instanceof vscode.TabInputNotebook
    ? input.uri
    : input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff
      ? input.modified
      : undefined;
}

function inputLanguageId(input: vscode.Tab['input'], uri: vscode.Uri | undefined): string | undefined {
  if (input instanceof vscode.TabInputNotebook || input instanceof vscode.TabInputNotebookDiff) {
    return input instanceof vscode.TabInputNotebook ? input.notebookType : undefined;
  }
  if (!uri) return undefined;
  return vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString())?.languageId;
}

function activeEditorId(input: vscode.Tab['input']): string {
  if (input instanceof vscode.TabInputCustom) return input.viewType;
  if (input instanceof vscode.TabInputNotebook) return input.notebookType;
  if (input instanceof vscode.TabInputNotebookDiff) return 'workbench.editors.notebookTextDiffEditor';
  if (input instanceof vscode.TabInputTextDiff) return 'workbench.editors.textDiffEditor';
  if (input instanceof vscode.TabInputText) return 'workbench.editors.textEditor';
  if (input instanceof vscode.TabInputTerminal) return 'terminalEditor';
  if (input instanceof vscode.TabInputWebview) return input.viewType;
  return '';
}
