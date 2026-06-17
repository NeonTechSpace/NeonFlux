import { initLogger, log } from 'evlog';

import type { LogLevel } from '@neonflux/config';

type LogContext = Record<string, unknown>;

type LoggerConfig = {
    logLevel: LogLevel;
    nodeEnv: 'development' | 'test' | 'production';
};

export type AppLogger = ReturnType<typeof createLogger>;

export function createLogger(config: LoggerConfig) {
    initLogger({
        minLevel: config.logLevel,
        pretty: config.nodeEnv !== 'production',
    });

    return {
        debug(event: string, context: LogContext = {}) {
            log.debug({ event, ...context });
        },
        info(event: string, context: LogContext = {}) {
            log.info({ event, ...context });
        },
        warn(event: string, context: LogContext = {}) {
            log.warn({ event, ...context });
        },
        error(event: string, context: LogContext = {}) {
            log.error({ event, ...context });
        },
    };
}
