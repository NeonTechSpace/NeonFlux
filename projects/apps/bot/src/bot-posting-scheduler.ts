import { randomUUID } from 'node:crypto';

import type { AppLogger } from '@neonflux/core/logging';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { runNextDashboardPostingOperation } from './bot-posting-worker.js';

const schedulerIntervalMs = 2_000;
const maxWorkItemsPerRun = 20;

export function startDashboardPostingScheduler(input: {
    context: BotFeatureHandlerContext;
    logger: AppLogger;
    intervalMs?: number;
}) {
    const leaseOwner = `dashboard-posting-worker:${randomUUID()}`;
    let stopped = false;
    let running: Promise<void> | undefined;

    const runOnce = async () => {
        for (let index = 0; index < maxWorkItemsPerRun && !stopped; index += 1) {
            const result = await runNextDashboardPostingOperation(input.context, { leaseOwner });
            if (result.status === 'idle') return;
            if (result.status === 'deferred' && result.operationId === 'unknown') return;
            if (result.status === 'unknown' || result.status === 'permanent_failure') {
                input.logger.error('posting.operation_requires_attention', {
                    errorCode: result.errorCode,
                    operationId: result.operationId,
                    status: result.status,
                });
            }
        }
    };
    const startRun = () => {
        if (running || stopped) return;
        running = runOnce()
            .catch((error: unknown) => {
                input.logger.error('posting.worker_failed', {
                    errorType: error instanceof Error ? error.name : typeof error,
                });
            })
            .finally(() => {
                running = undefined;
            });
    };
    const interval = setInterval(startRun, input.intervalMs ?? schedulerIntervalMs);
    startRun();

    return {
        async stop(): Promise<void> {
            stopped = true;
            clearInterval(interval);
            await running;
        },
    };
}
