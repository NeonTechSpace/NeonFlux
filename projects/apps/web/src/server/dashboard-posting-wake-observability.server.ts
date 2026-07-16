import type { AppLogger } from '@neonflux/core/logging';

import { getWebLogger } from './web-logger.server.js';

export type DashboardPostingWakeFailureClass =
    | 'not-configured'
    | 'auth-failed'
    | 'transport-failed'
    | 'invalid-response'
    | 'unexpected-failure';

type WakeLogger = Pick<AppLogger, 'info' | 'warn'>;

const warningIntervalMs = 60_000;

export function createDashboardPostingWakeObserver(input?: { logger?: WakeLogger; now?: () => number }) {
    const logger = input?.logger ?? safelyGetWebLogger();
    const now = input?.now ?? Date.now;
    const failures = new Map<DashboardPostingWakeFailureClass, { lastLoggedAtMs: number; suppressed: number }>();
    let outageStartedAtMs: number | undefined;
    let totalSuppressed = 0;

    return {
        failure(errorClass: DashboardPostingWakeFailureClass, requestDurationMs: number): void {
            const observedAtMs = safeNow(now());
            outageStartedAtMs ??= observedAtMs;
            const previous = failures.get(errorClass);

            if (previous && observedAtMs - previous.lastLoggedAtMs < warningIntervalMs) {
                previous.suppressed += 1;
                totalSuppressed += 1;
                return;
            }

            try {
                logger?.warn('posting.wake_failed', {
                    errorClass,
                    requestDurationMs: safeDuration(requestDurationMs),
                    suppressedCount: previous?.suppressed ?? 0,
                });
            } catch {
                // Observability must not change posting results.
            }
            failures.set(errorClass, { lastLoggedAtMs: observedAtMs, suppressed: 0 });
        },

        success(): void {
            if (outageStartedAtMs === undefined) return;
            const recoveredAtMs = safeNow(now());
            try {
                logger?.info('posting.wake_recovered', {
                    outageDurationMs: safeDuration(recoveredAtMs - outageStartedAtMs),
                    suppressedCount: totalSuppressed,
                });
            } catch {
                // Observability must not change posting results.
            }
            failures.clear();
            outageStartedAtMs = undefined;
            totalSuppressed = 0;
        },
    };
}

function safelyGetWebLogger(): WakeLogger | undefined {
    try {
        return getWebLogger();
    } catch {
        return undefined;
    }
}

let defaultObserver: ReturnType<typeof createDashboardPostingWakeObserver> | undefined;

export function recordDashboardPostingWakeFailure(
    errorClass: DashboardPostingWakeFailureClass,
    requestDurationMs: number
): void {
    defaultObserver ??= createDashboardPostingWakeObserver();
    defaultObserver.failure(errorClass, requestDurationMs);
}

export function recordDashboardPostingWakeSuccess(): void {
    defaultObserver ??= createDashboardPostingWakeObserver();
    defaultObserver.success();
}

function safeNow(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeDuration(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
