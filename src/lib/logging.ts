export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  component?: string;
  sandbox?: string;
  requestId?: string;
  event?: string;
  error?: string | Error;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  component?: string;
  sandbox?: string;
  requestId?: string;
  event?: string;
  error?: string;
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private minLevel: LogLevel;
  private output: (line: string) => void;

  constructor(opts?: { level?: LogLevel; output?: (line: string) => void }) {
    this.minLevel = opts?.level ?? 'info';
    this.output = opts?.output ?? ((line) => process.stderr.write(line + '\n'));
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        if (key === 'error' && value instanceof Error) {
          entry.error = value.message;
        } else {
          entry[key] = value;
        }
      }
    }

    this.output(JSON.stringify(entry));
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }
}

/** Singleton logger instance for the application. */
export const logger = new Logger();
