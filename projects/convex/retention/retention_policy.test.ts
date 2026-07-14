import { describe, expect, it } from 'vitest';

import {
    DATA_RETENTION_DAYS_DEFAULT,
    DATA_RETENTION_DAYS_ENV,
    DATA_RETENTION_DAYS_MAX,
    dataRetentionCutoff,
    readDataRetentionDays,
} from './retention_policy.js';

describe('data retention policy', () => {
    it('defaults to 90 days and accepts the inclusive configured range', () => {
        expect(readDataRetentionDays({})).toBe(DATA_RETENTION_DAYS_DEFAULT);
        expect(readDataRetentionDays({ [DATA_RETENTION_DAYS_ENV]: '1' })).toBe(1);
        expect(readDataRetentionDays({ [DATA_RETENTION_DAYS_ENV]: String(DATA_RETENTION_DAYS_MAX) })).toBe(730);
    });

    it.each(['', ' 90', '90 ', '1.5', 'abc', '0', '731', '-1'])(
        'rejects invalid or out-of-range configuration %j',
        (value) => {
            expect(() => readDataRetentionDays({ [DATA_RETENTION_DAYS_ENV]: value })).toThrow(
                /data-retention-days-(?:invalid|out-of-range)/
            );
        }
    );

    it('creates an exact UTC cutoff from the validated policy', () => {
        expect(dataRetentionCutoff('2026-07-14T12:00:00.000Z', 90)).toBe('2026-04-15T12:00:00.000Z');
    });
});
