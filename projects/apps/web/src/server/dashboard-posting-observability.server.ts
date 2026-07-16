import type { AppLogger } from '@neonflux/core/logging';

import { getWebLogger } from './web-logger.server.js';

export type DashboardPostingRequestResultClass =
    | 'operation'
    | 'auth_required'
    | 'not_found'
    | 'deployment_config_not_found'
    | 'guild_lookup_failed'
    | 'database_error'
    | 'invalid_message'
    | 'request_conflict';

export type DashboardPostingRequestStage =
    | 'authContextMs'
    | 'targetAuthorizationMs'
    | 'validationMs'
    | 'enqueueMs'
    | 'wakeMs';

type PostingTimingLogger = Pick<AppLogger, 'info'>;

export function createDashboardPostingRequestTiming(input?: { logger?: PostingTimingLogger; now?: () => number }) {
    const logger = input?.logger ?? safelyGetWebLogger();
    const now = input?.now ?? Date.now;
    const requestStartedAtMs = now();
    const durations: Partial<Record<DashboardPostingRequestStage, number>> = {};
    let finished = false;

    const measure = <T>(stage: DashboardPostingRequestStage, action: () => T): T => {
        const startedAtMs = now();
        try {
            return action();
        } finally {
            durations[stage] = elapsedMs(startedAtMs, now());
        }
    };

    const measureAsync = async <T>(stage: DashboardPostingRequestStage, action: () => Promise<T>): Promise<T> => {
        const startedAtMs = now();
        try {
            return await action();
        } finally {
            durations[stage] = elapsedMs(startedAtMs, now());
        }
    };

    const finish = (result: DashboardPostingRequestResultClass, operationId?: string): void => {
        if (finished) return;
        finished = true;
        try {
            logger?.info('posting.request_timing', {
                result,
                ...(operationId ? { operationId } : {}),
                requestStartedAtMs: toSafeTimestamp(requestStartedAtMs),
                ...durations,
                requestTotalMs: elapsedMs(requestStartedAtMs, now()),
            });
        } catch {
            // Observability must not change posting results.
        }
    };

    const getDuration = (stage: DashboardPostingRequestStage): number | undefined => durations[stage];

    return { finish, getDuration, measure, measureAsync };
}

function safelyGetWebLogger(): PostingTimingLogger | undefined {
    try {
        return getWebLogger();
    } catch {
        return undefined;
    }
}

function elapsedMs(startedAtMs: number, completedAtMs: number): number {
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) return 0;
    return Math.max(0, Math.round(completedAtMs - startedAtMs));
}

function toSafeTimestamp(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
