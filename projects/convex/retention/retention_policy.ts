export const DATA_RETENTION_DAYS_DEFAULT = 90;
export const DATA_RETENTION_DAYS_MAX = 730;
export const DATA_RETENTION_DAYS_ENV = 'NEONFLUX_DATA_RETENTION_DAYS';

export function readDataRetentionDays(environment: Readonly<Record<string, string | undefined>> = process.env): number {
    const configured = environment[DATA_RETENTION_DAYS_ENV];
    if (configured === undefined) return DATA_RETENTION_DAYS_DEFAULT;
    if (!/^\d+$/.test(configured)) throw new Error('data-retention-days-invalid');

    const days = Number(configured);
    if (!Number.isSafeInteger(days) || days < 1 || days > DATA_RETENTION_DAYS_MAX) {
        throw new Error('data-retention-days-out-of-range');
    }

    return days;
}

export function dataRetentionCutoff(now: string, retentionDays: number): string {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new Error('data-retention-now-invalid');
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > DATA_RETENTION_DAYS_MAX) {
        throw new Error('data-retention-days-out-of-range');
    }

    return new Date(nowMs - retentionDays * 24 * 60 * 60 * 1_000).toISOString();
}
