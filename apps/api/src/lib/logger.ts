const SENSITIVE_KEY_PATTERN =
  /(password|passcode|secret|token|apikey|api_key|authorization|cookie|credential|privatekey|private_key)/i;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: (line: string) => void;
  base?: Record<string, unknown>;
}

/** Recursively redacts secret-looking fields before anything reaches a log. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name };
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? '[redacted]'
        : redact(child, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}...`;
  }
  return value;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink =
    options.sink ??
    ((line: string) => {
      console.log(line);
    });
  const base = options.base ?? {};

  const write = (
    entryLevel: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): void => {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const entry = {
      time: new Date().toISOString(),
      level: entryLevel,
      message,
      ...(redact(base) as Record<string, unknown>),
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    sink(JSON.stringify(entry));
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) =>
      createLogger({
        level,
        sink,
        base: { ...base, ...(redact(fields) as Record<string, unknown>) },
      }),
  };
}

export function createSilentLogger(): Logger {
  const noop = (): void => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => createSilentLogger(),
  };
}
