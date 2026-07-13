import { describe, expect, it } from 'vitest';

import { normalizeDashboardPostingPayload } from './posting_operation_model.js';
import { hasActiveDashboardPostingOperationLease } from './posting_operation_worker.js';
import { selectPrunableDashboardPostingOperations } from './posting_operations.js';

describe('dashboard posting operation model', () => {
    it('normalizes JSON without allowing __proto__ to mutate the output prototype', () => {
        const embed = JSON.parse('{"__proto__":{"polluted":true},"title":"Safe"}') as Record<string, unknown>;

        const payload = normalizeDashboardPostingPayload({ embeds: [embed] });
        const normalized = payload.embeds[0] as Record<string, unknown>;

        expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
        expect(Object.hasOwn(normalized, '__proto__')).toBe(true);
        expect(normalized.__proto__).toStrictEqual({ polluted: true });
        expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('selects only expired terminal rows for retention pruning', () => {
        const now = '2026-07-13T12:00:00.000Z';
        const queued = Array.from({ length: 150 }, () => ({ status: 'queued' as const }));
        const running = [{ expiresAt: '2026-07-01T00:00:00.000Z', status: 'running' as const }];
        const retainedTerminal = [{ expiresAt: '2026-08-01T00:00:00.000Z', status: 'sent' as const }];
        const expiredTerminal = [
            { expiresAt: '2026-07-01T00:00:00.000Z', status: 'unknown' as const },
            { expiresAt: '2026-07-02T00:00:00.000Z', status: 'permanent_failure' as const },
        ];

        expect(
            selectPrunableDashboardPostingOperations(
                [...queued, ...running, ...retainedTerminal, ...expiredTerminal],
                now
            )
        ).toStrictEqual(expiredTerminal);
    });

    it('rejects stale, expired, and malformed worker leases', () => {
        const running = {
            leaseExpiresAt: '2026-07-13T12:01:00.000Z',
            leaseId: 'lease-1',
            status: 'running' as const,
        };

        expect(hasActiveDashboardPostingOperationLease(running, 'lease-1', '2026-07-13T12:00:59.999Z')).toBe(true);
        expect(hasActiveDashboardPostingOperationLease(running, 'lease-2', '2026-07-13T12:00:00.000Z')).toBe(false);
        expect(hasActiveDashboardPostingOperationLease(running, 'lease-1', running.leaseExpiresAt)).toBe(false);
        expect(hasActiveDashboardPostingOperationLease(running, 'lease-1', 'not-a-date')).toBe(false);
    });
});
