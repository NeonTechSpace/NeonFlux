import { initLogger, log } from 'evlog';

import type { LogLevel } from '@neonflux/config';

type LogContext = Record<string, unknown>;

type LoggerConfig = {
    logLevel: LogLevel;
    nodeEnv: 'development' | 'test' | 'production';
};

export type AppLogger = ReturnType<typeof createLogger>;

export function createLogger(config: LoggerConfig) {
    const colorizeValues = config.nodeEnv === 'development' && shouldUseAnsiColor();

    initLogger({
        minLevel: config.logLevel,
        pretty: config.nodeEnv !== 'production',
    });

    return {
        debug(event: string, context: LogContext = {}) {
            log.debug(createLogEvent(event, context, colorizeValues));
        },
        info(event: string, context: LogContext = {}) {
            log.info(createLogEvent(event, context, colorizeValues));
        },
        warn(event: string, context: LogContext = {}) {
            log.warn(createLogEvent(event, context, colorizeValues));
        },
        error(event: string, context: LogContext = {}) {
            log.error(createLogEvent(event, context, colorizeValues));
        },
    };
}

const ansi = {
    blue: '\u001B[34m',
    cyan: '\u001B[36m',
    green: '\u001B[32m',
    magenta: '\u001B[35m',
    red: '\u001B[31m',
    reset: '\u001B[0m',
    yellow: '\u001B[33m',
} as const;

const idFields = new Set(['authorId', 'channelId', 'guildId', 'messageId']);
const actionFields = new Set(['action', 'event', 'eventType']);
const reasonFields = new Set(['reason']);
const securityFields = new Set(['guildDefconOverride', 'instanceMode']);
const failureFields = new Set(['error', 'errorCode', 'errorMessage', 'errorName', 'statusCode']);

function createLogEvent(event: string, context: LogContext, colorizeValues: boolean): LogContext {
    const logEvent: LogContext = {
        event: colorizeLogField('event', event, colorizeValues),
    };

    for (const [key, value] of Object.entries(context)) {
        logEvent[key] = colorizeLogField(key, value, colorizeValues);
    }

    return logEvent;
}

function colorizeLogField(key: string, value: unknown, enabled: boolean): unknown {
    if (!enabled || !isColorizableLogValue(value)) {
        return value;
    }

    const text = String(value);

    if (key === 'status') {
        return colorizeStatus(text);
    }

    if (failureFields.has(key) || text.includes('failed') || text.includes('error')) {
        return colorize(text, ansi.red);
    }

    if (reasonFields.has(key)) {
        return colorize(text, ansi.yellow);
    }

    if (actionFields.has(key)) {
        return colorize(text, ansi.cyan);
    }

    if (idFields.has(key)) {
        return colorize(text, ansi.blue);
    }

    if (securityFields.has(key)) {
        return colorize(text, ansi.magenta);
    }

    return value;
}

function colorizeStatus(status: string): string {
    switch (status) {
        case 'applied':
        case 'handled':
        case 'ready':
        case 'recorded':
        case 'removed':
        case 'success':
            return colorize(status, ansi.green);

        case 'ignored':
        case 'skipped':
            return colorize(status, ansi.yellow);

        case 'failed':
        case 'unavailable':
            return colorize(status, ansi.red);

        default:
            return colorize(status, ansi.cyan);
    }
}

function isColorizableLogValue(value: unknown): value is string | number | boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function colorize(value: string, color: string): string {
    return `${color}${value}${ansi.reset}`;
}

function shouldUseAnsiColor(): boolean {
    const env = getRuntimeEnv();

    return env.NO_COLOR === undefined && env.FORCE_COLOR !== '0';
}

function getRuntimeEnv(): Record<string, string | undefined> {
    const runtime = globalThis as Record<string, unknown>;
    const processValue = runtime.process;

    if (!isRecord(processValue)) {
        return {};
    }

    const envValue = processValue.env;

    if (!isRecord(envValue)) {
        return {};
    }

    return envValue as Record<string, string | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
