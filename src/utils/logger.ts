export type LogLevelName = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevelName, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function levelFromEnv(): LogLevelName {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  return raw && raw in LEVEL_ORDER ? (raw as LogLevelName) : 'info';
}

/**
 * All output goes to stderr: stdout carries the MCP JSON-RPC stream (and, for
 * the CLI, the response envelope), so a single stray line there corrupts it.
 * `LOG_LEVEL` filters what reaches stderr; the default keeps info and above.
 */
export class Logger {
  private static level: LogLevelName = levelFromEnv();
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  static setLogLevel(level: LogLevelName): void {
    Logger.level = level;
  }

  private enabled(level: LogLevelName): boolean {
    return LEVEL_ORDER[Logger.level] >= LEVEL_ORDER[level];
  }

  info(message: string, ...args: any[]): void {
    if (this.enabled('info')) console.error(`[${this.name}] INFO: ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    if (this.enabled('error')) console.error(`[${this.name}] ERROR: ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    if (this.enabled('warn')) console.error(`[${this.name}] WARN: ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (this.enabled('debug')) console.error(`[${this.name}] DEBUG: ${message}`, ...args);
  }
}
