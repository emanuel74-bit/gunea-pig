import pino, { Logger, LoggerOptions } from 'pino';

export type AppLogger = Logger;

export interface LoggerConfig {
  level?: string;
  prettyPrint?: boolean;
  service?: string;
}

/**
 * Creates a structured Pino logger.
 * In production (NODE_ENV=production) JSON output is used.
 * In development, pino-pretty is activated for human-readable output.
 */
export function createLogger(config: LoggerConfig = {}): AppLogger {
  const level = config.level ?? process.env.LOG_LEVEL ?? 'info';
  const isDev = (process.env.NODE_ENV ?? 'production') !== 'production';

  const options: LoggerOptions = {
    level,
    base: config.service ? { service: config.service } : undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };

  if (isDev || config.prettyPrint) {
    return pino(
      options,
      pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      }),
    );
  }

  return pino(options);
}

export { Logger };
