export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'requestRefresh' };

export type ExtensionMessage =
  | { readonly type: 'renderPlaceholder'; readonly title: string };

export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as { type?: unknown };
  if (candidate.type === 'ready' || candidate.type === 'requestRefresh') {
    return { type: candidate.type };
  }

  return undefined;
}
