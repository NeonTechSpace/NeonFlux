import { describe, expect, it } from 'vitest';

import { parseBackfillAuditSortKeysArgs } from './convex-backfill-audit-sort-keys.js';

describe('convex audit sort key backfill script', () => {
    it('parses guarded batch arguments', () => {
        expect(parseBackfillAuditSortKeysArgs([])).toStrictEqual({
            confirmProductionBackfill: false,
            limit: 100,
        });
        expect(parseBackfillAuditSortKeysArgs(['--confirm-production-backfill', '--limit', '250'])).toStrictEqual({
            confirmProductionBackfill: true,
            limit: 250,
        });
        expect(parseBackfillAuditSortKeysArgs(['--limit=1000'])).toStrictEqual({
            confirmProductionBackfill: false,
            limit: 500,
        });
    });

    it('rejects invalid arguments', () => {
        expect(() => parseBackfillAuditSortKeysArgs(['--limit'])).toThrow('--limit requires a value');
        expect(() => parseBackfillAuditSortKeysArgs(['--limit=oops'])).toThrow('--limit must be a finite number');
        expect(() => parseBackfillAuditSortKeysArgs(['--unknown'])).toThrow('Unexpected argument');
    });
});
