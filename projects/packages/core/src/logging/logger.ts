import { initLogger, log } from 'evlog';

import type { LogLevel } from '@neonflux/config';

type LogContext = Record<string, unknown>;

const redactedValue = '[REDACTED]';
const circularValue = '[Circular]';
const maximumDepthValue = '[Maximum depth]';
const truncatedValue = '[Truncated]';
const unserializableValue = '[Unserializable]';
const maximumCollectionEntries = 50;
const maximumDepth = 6;
const maximumStringLength = 2_048;
const maximumContextCharacters = 16_384;
const sensitiveKeySuffixes = [
    'authorization',
    'cookie',
    'password',
    'passwd',
    'privatekey',
    'secret',
    'token',
] as const;
const sensitiveRawKeys = new Set([
    'payload',
    'providerbody',
    'providerpayload',
    'providerresponse',
    'rawbody',
    'rawpayload',
    'requestbody',
    'responsebody',
]);

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
        event: colorizeLogField('event', truncateText(event), colorizeValues),
    };

    for (const [key, value] of Object.entries(sanitizeLogContext(context))) {
        logEvent[key] = colorizeLogField(key, value, colorizeValues);
    }

    return logEvent;
}

export function sanitizeLogContext(context: LogContext): LogContext {
    const state: SanitizationState = {
        ancestors: new WeakSet<object>(),
        remainingCharacters: maximumContextCharacters,
    };
    const sanitized = sanitizeObject(context, 0, state);
    return isRecord(sanitized) ? sanitized : { context: sanitized };
}

type SanitizationState = {
    ancestors: WeakSet<object>;
    remainingCharacters: number;
};

function sanitizeValue(value: unknown, key: string | undefined, depth: number, state: SanitizationState): unknown {
    if (key && isSensitiveKey(key)) return redactedValue;
    if (state.remainingCharacters <= 0) return truncatedValue;
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
        consumeCharacters(state, String(value).length);
        return value;
    }
    if (typeof value === 'string') {
        const truncated = truncateText(value);
        consumeCharacters(state, truncated.length);
        return truncated;
    }
    if (typeof value === 'bigint') {
        const serialized = `${String(value)}n`;
        consumeCharacters(state, serialized.length);
        return serialized;
    }
    if (typeof value === 'symbol' || typeof value === 'function') {
        const description = `[${typeof value}]`;
        consumeCharacters(state, description.length);
        return description;
    }
    if (depth >= maximumDepth) return maximumDepthValue;
    if (state.ancestors.has(value)) return circularValue;

    if (value instanceof Date) {
        const timestamp = Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
        consumeCharacters(state, timestamp.length);
        return timestamp;
    }
    if (value instanceof Error) return sanitizeError(value, depth, state);
    if (Array.isArray(value)) return sanitizeArray(value, depth, state);
    if (value instanceof Map) return sanitizeArray([...value.entries()], depth, state);
    if (value instanceof Set) return sanitizeArray([...value.values()], depth, state);
    return sanitizeObject(value, depth, state);
}

function sanitizeArray(value: readonly unknown[], depth: number, state: SanitizationState): unknown[] {
    state.ancestors.add(value);
    const entries = value
        .slice(0, maximumCollectionEntries)
        .map((entry) => sanitizeValue(entry, undefined, depth + 1, state));
    if (value.length > maximumCollectionEntries) {
        entries.push(`[${String(value.length - maximumCollectionEntries)} more entries]`);
    }
    state.ancestors.delete(value);
    return entries;
}

function sanitizeObject(value: object, depth: number, state: SanitizationState): LogContext | string {
    state.ancestors.add(value);
    let entries: Array<[string, unknown]>;
    try {
        entries = Object.entries(value).slice(0, maximumCollectionEntries);
    } catch {
        state.ancestors.delete(value);
        return unserializableValue;
    }

    const sanitizedEntries: Array<[string, unknown]> = [];
    for (const [key, entryValue] of entries) {
        if (state.remainingCharacters <= 0) {
            sanitizedEntries.push(['truncated', truncatedValue]);
            break;
        }
        consumeCharacters(state, key.length);
        sanitizedEntries.push([key, sanitizeValue(entryValue, key, depth + 1, state)]);
    }
    const totalEntries = safeOwnKeyCount(value);
    if (totalEntries > maximumCollectionEntries) {
        sanitizedEntries.push(['truncatedEntries', totalEntries - maximumCollectionEntries]);
    }
    state.ancestors.delete(value);
    return Object.fromEntries(sanitizedEntries);
}

function sanitizeError(error: Error, depth: number, state: SanitizationState): LogContext {
    state.ancestors.add(error);
    const errorRecord = error as Error & {
        code?: unknown;
        status?: unknown;
        statusCode?: unknown;
    };
    const sanitized = Object.fromEntries(
        [
            ['name', error.name],
            ['message', error.message],
            ['code', errorRecord.code],
            ['status', errorRecord.status],
            ['statusCode', errorRecord.statusCode],
        ]
            .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
            .map(([key, value]) => [key, sanitizeValue(value, key, depth + 1, state)])
    );
    state.ancestors.delete(error);
    return sanitized;
}

function isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
    return (
        sensitiveRawKeys.has(normalized) ||
        sensitiveKeySuffixes.some((suffix) => normalized === suffix || normalized.endsWith(suffix))
    );
}

function truncateText(value: string): string {
    if (value.length <= maximumStringLength) return value;
    const omitted = value.length - maximumStringLength;
    return `${value.slice(0, maximumStringLength)}…[${String(omitted)} chars omitted]`;
}

function consumeCharacters(state: SanitizationState, amount: number): void {
    state.remainingCharacters = Math.max(0, state.remainingCharacters - amount);
}

function safeOwnKeyCount(value: object): number {
    try {
        return Object.keys(value).length;
    } catch {
        return maximumCollectionEntries;
    }
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
