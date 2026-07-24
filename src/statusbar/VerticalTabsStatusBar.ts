import * as vscode from 'vscode';
import { getStrings, resolveLocale } from '../i18n';
import { VerticalTabsPanel } from '../webview/VerticalTabsPanel';
import { buildStatusBarPresentation, type VerticalTabsSide } from './statusBarPresentation';

const STATUS_BAR_ID = 'verticalTabs.toggleStatusBar';
const STATUS_BAR_PRIORITY = 100;

export class VerticalTabsStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    STATUS_BAR_ID,
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY,
  );
  private readonly disposables: vscode.Disposable[];

  constructor() {
    this.item.command = 'verticalTabs.toggle';
    this.disposables = [
      this.item,
      VerticalTabsPanel.onDidChangeVisibility(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('verticalTabs.position')
          || event.affectsConfiguration('verticalTabs.language')
        ) {
          this.refresh();
        }
      }),
    ];
    this.refresh();
    this.item.show();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refresh(): void {
    const configuration = vscode.workspace.getConfiguration('verticalTabs');
    const configuredLanguage = configuration.get<string>('language', 'auto');
    const language = configuredLanguage?.toLowerCase() === 'auto'
      ? vscode.env.language
      : (configuredLanguage ?? 'en');
    const strings = getStrings(resolveLocale(language));
    const side: VerticalTabsSide = configuration.get<string>('position', 'left') === 'right'
      ? 'right'
      : 'left';
    const presentation = buildStatusBarPresentation(VerticalTabsPanel.isOpen(), side, strings);

    this.item.text = presentation.text;
    this.item.tooltip = presentation.tooltip;
    this.item.name = presentation.name;
    this.item.accessibilityInformation = {
      label: presentation.accessibilityLabel,
      role: 'button',
    };
  }
}
