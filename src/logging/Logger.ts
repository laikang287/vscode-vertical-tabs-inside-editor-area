export enum LogLevel {
  Trace = 10,
  Debug = 20,
  Info = 30,
  Warn = 40,
  Error = 50,
  Off = 60,
}

// Change this single constant when a quieter build is needed. Debug is kept
// intentionally for now so startup and editor-layout failures can be diagnosed.
export const ACTIVE_LOG_LEVEL = LogLevel.Debug;

export interface LogSink {
  appendLine(value: string): void;
}

const LEVEL_LABELS: Readonly<Record<LogLevel, string>> = {
  [LogLevel.Trace]: 'TRACE',
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
  [LogLevel.Off]: 'OFF',
};

export class Logger {
  constructor(
    private readonly sink: LogSink,
    readonly level: LogLevel = ACTIVE_LOG_LEVEL,
    private readonly now: () => Date = () => new Date(),
  ) {}

  trace(message: string, details?: unknown): void {
    this.write(LogLevel.Trace, message, details);
  }

  debug(message: string, details?: unknown): void {
    this.write(LogLevel.Debug, message, details);
  }

  info(message: string, details?: unknown): void {
    this.write(LogLevel.Info, message, details);
  }

  warn(message: string, details?: unknown): void {
    this.write(LogLevel.Warn, message, details);
  }

  error(message: string, details?: unknown): void {
    this.write(LogLevel.Error, message, details);
  }

  private write(level: LogLevel, message: string, details?: unknown): void {
    if (level < this.level || this.level === LogLevel.Off) {
      return;
    }
    const suffix = details === undefined ? '' : ` | ${serializeDetails(details)}`;
    this.sink.appendLine(`${this.now().toISOString()} [${LEVEL_LABELS[level]}] ${message}${suffix}`);
  }
}

function serializeDetails(details: unknown): string {
  if (details instanceof Error) {
    return details.stack ?? `${details.name}: ${details.message}`;
  }
  if (typeof details === 'string') {
    return details;
  }
  try {
    return JSON.stringify(details, (_key, value: unknown) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      return typeof value === 'bigint' ? value.toString() : value;
    }) ?? String(details);
  } catch {
    return String(details);
  }
}
