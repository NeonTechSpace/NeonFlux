import { describe, expect, it, vi } from 'vitest';

import { createDashboardPostingWakeObserver } from './dashboard-posting-wake-observability.server.js';

describe('dashboard posting wake observability', () => {
    it('rate limits each failure class and reports recovery once', () => {
        const info = vi.fn();
        const warn = vi.fn();
        let now = 1_000;
        const observer = createDashboardPostingWakeObserver({ logger: { info, warn }, now: () => now });

        observer.failure('transport-failed', 12.4);
        now += 1_000;
        observer.failure('transport-failed', 15);
        observer.failure('auth-failed', 20);
        now += 59_000;
        observer.failure('transport-failed', 30);
        now += 500;
        observer.success();
        observer.success();

        expect(warn).toHaveBeenCalledTimes(3);
        expect(warn).toHaveBeenNthCalledWith(1, 'posting.wake_failed', {
            errorClass: 'transport-failed',
            requestDurationMs: 12,
            suppressedCount: 0,
        });
        expect(warn).toHaveBeenNthCalledWith(2, 'posting.wake_failed', {
            errorClass: 'auth-failed',
            requestDurationMs: 20,
            suppressedCount: 0,
        });
        expect(warn).toHaveBeenNthCalledWith(3, 'posting.wake_failed', {
            errorClass: 'transport-failed',
            requestDurationMs: 30,
            suppressedCount: 1,
        });
        expect(info).toHaveBeenCalledTimes(1);
        expect(info).toHaveBeenCalledWith('posting.wake_recovered', {
            outageDurationMs: 60_500,
            suppressedCount: 1,
        });
    });

    it('normalizes invalid durations without logging ordinary success', () => {
        const info = vi.fn();
        const warn = vi.fn();
        const observer = createDashboardPostingWakeObserver({ logger: { info, warn }, now: () => Number.NaN });

        observer.success();
        observer.failure('unexpected-failure', Number.POSITIVE_INFINITY);

        expect(info).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith('posting.wake_failed', {
            errorClass: 'unexpected-failure',
            requestDurationMs: 0,
            suppressedCount: 0,
        });
    });

    it('does not allow warning or recovery logging failures to alter posting behavior', () => {
        const observer = createDashboardPostingWakeObserver({
            logger: {
                info: vi.fn(() => {
                    throw new Error('logger unavailable');
                }),
                warn: vi.fn(() => {
                    throw new Error('logger unavailable');
                }),
            },
            now: () => 100,
        });

        expect(() => observer.failure('auth-failed', 10)).not.toThrow();
        expect(() => observer.success()).not.toThrow();
    });
});
