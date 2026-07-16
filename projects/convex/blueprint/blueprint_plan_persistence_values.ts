import { getDocumentSize, type Value } from 'convex/values';

export const MAX_PLAN_METADATA_BYTES = 16 * 1024;
export const MAX_PLAN_AUTHORITY_BYTES = 700 * 1024;
export const MAX_PLAN_EXECUTION_AUTHORITY_MANIFEST_BYTES = 8 * 1024;
export const MAX_PLAN_EXECUTION_AUTHORITY_BUCKET_BYTES = 8 * 1024;
export const MAX_PLAN_LEDGER_BYTES = 8 * 1024 * 1024;
export const MAX_PLAN_STEP_BYTES = 256 * 1024;

export function assertDocumentSize(value: unknown, maximum: number, errorType: string): void {
    if (!isRecord(value) || getDocumentSize(value as Record<string, Value>) > maximum) throw new Error(errorType);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stripConvexMetadata<T extends { _id: unknown; _creationTime: unknown }>(
    value: T
): Omit<T, '_id' | '_creationTime'> {
    const { _id: _id, _creationTime: _creationTime, ...document } = value;
    void _id;
    void _creationTime;
    return document;
}

export function requireCanonicalText(value: string, errorType: string): string {
    if (value.length === 0 || value !== value.trim()) throw new Error(errorType);
    return value;
}

export function requireTimestamp(value: string, errorType: string): string {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(errorType);
    const canonical = new Date(parsed).toISOString();
    if (canonical !== value) throw new Error(errorType);
    return canonical;
}

export function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
}
