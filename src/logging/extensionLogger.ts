import * as vscode from 'vscode';
import { ACTIVE_LOG_LEVEL, LogLevel, Logger } from './Logger';

const OUTPUT_CHANNEL_NAME = 'Vertical Tabs';
let outputChannel: vscode.OutputChannel | undefined;
let logger: Logger | undefined;

export function initializeLogging(context: vscode.ExtensionContext): void {
  if (logger) {
    return;
  }
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  logger = new Logger(outputChannel, ACTIVE_LOG_LEVEL);
  context.subscriptions.push(outputChannel);
  logger.info('日志系统已初始化', { level: LogLevel[ACTIVE_LOG_LEVEL], channel: OUTPUT_CHANNEL_NAME });
}

export function showLogs(): void {
  logDebug('显示日志输出通道');
  outputChannel?.show(true);
}

export function logTrace(message: string, details?: unknown): void {
  logger?.trace(message, details);
}

export function logDebug(message: string, details?: unknown): void {
  logger?.debug(message, details);
}

export function logInfo(message: string, details?: unknown): void {
  logger?.info(message, details);
}

export function logWarn(message: string, details?: unknown): void {
  logger?.warn(message, details);
}

export function logError(message: string, details?: unknown): void {
  logger?.error(message, details);
}
