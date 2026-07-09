import { redact, type Redactable } from "./redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  request_id?: string;
  correlation_id?: string;
  [key: string]: Redactable | undefined;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  sink?: (line: string) => void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? "info";
  const sink = options.sink ?? ((line) => process.stdout.write(`${line}\n`));

  function write(logLevel: LogLevel, message: string, fields: LogFields = {}) {
    if (LEVEL_WEIGHT[logLevel] < LEVEL_WEIGHT[level]) {
      return;
    }

    const payload = redact({
      timestamp: new Date().toISOString(),
      level: logLevel,
      service: options.service,
      message,
      ...fields,
    });

    sink(JSON.stringify(payload));
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export { redact, redactString } from "./redaction";
