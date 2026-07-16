import { describe, expect, it, vi } from 'vitest';

import { createDashboardPostingRequestTiming } from './dashboard-posting-observability.server.js';

describe('dashboard posting observability', () => {
    it('records reached stages once with controlled timing fields', async () => {
        const info = vi.fn();
        const timestamps = [1_000, 1_005, 1_015, 1_020, 1_050, 1_080];
        const timing = createDashboardPostingRequestTiming({
            logger: { info },
            now: () => timestamps.shift() ?? 1_080,
        });

        await timing.measureAsync('authContextMs', async () => undefined);
        timing.measure('validationMs', () => undefined);
        timing.finish('operation', 'operation-1');
        timing.finish('database_error');

        expect(info).toHaveBeenCalledTimes(1);
        expect(info).toHaveBeenCalledWith('posting.request_timing', {
            result: 'operation',
            operationId: 'operation-1',
            requestStartedAtMs: 1_000,
            authContextMs: 10,
            validationMs: 30,
            requestTotalMs: 80,
        });
        expect(timing.getDuration('authContextMs')).toBe(10);
        expect(timing.getDuration('wakeMs')).toBeUndefined();
    });

    it('records failed stage duration and omits stages that were not reached', async () => {
        const info = vi.fn();
        const timestamps = [100, 110, 120, 140];
        const timing = createDashboardPostingRequestTiming({
            logger: { info },
            now: () => timestamps.shift() ?? 140,
        });

        await expect(
            timing.measureAsync('targetAuthorizationMs', async () => {
                throw new Error('expected');
            })
        ).rejects.toThrow('expected');
        timing.finish('guild_lookup_failed');

        expect(info).toHaveBeenCalledWith('posting.request_timing', {
            result: 'guild_lookup_failed',
            requestStartedAtMs: 100,
            targetAuthorizationMs: 10,
            requestTotalMs: 40,
        });
    });

    it('does not allow logging failures to alter posting behavior', () => {
        const timing = createDashboardPostingRequestTiming({
            logger: {
                info: vi.fn(() => {
                    throw new Error('logger unavailable');
                }),
            },
            now: () => 100,
        });

        expect(() => timing.finish('database_error')).not.toThrow();
    });
});
