import type { JsonValue } from './types.js';

export function stableJson(value: unknown): string {
    return JSON.stringify(normalizeForStableJson(value));
}

function normalizeForStableJson(value: unknown): JsonValue {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('base64');
    }

    if (Array.isArray(value)) {
        return value.map((item) => normalizeForStableJson(item));
    }

    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        return value;
    }

    if (typeof value === 'object') {
        const result: Record<string, JsonValue> = {};
        const source = value;

        for (const key of Object.keys(source).sort()) {
            result[key] = normalizeForStableJson(source[key as keyof typeof source]);
        }

        return result;
    }

    if (typeof value === 'symbol') {
        return value.toString();
    }

    if (typeof value === 'function') {
        return `[function ${value.name || 'anonymous'}]`;
    }

    return null;
}
