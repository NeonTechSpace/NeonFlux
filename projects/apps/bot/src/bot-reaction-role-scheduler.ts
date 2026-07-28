import { randomUUID } from 'node:crypto';

import type { AppLogger } from '@neonflux/core/logging';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { runNextReactionRoleOperation } from './bot-reaction-role-worker.js';
import { reconcileReactionRolePanels } from './bot-reaction-role-reconciliation.js';

const idleDelayMs = 15_000;
const maxOperationsPerDrain = 50;
const reconciliationIntervalMs = 6 * 60 * 60 * 1000;
const shutdownDrainTimeoutMs = 10_000;

export function startReactionRoleScheduler(input: {
    context: BotFeatureHandlerContext;
    logger: AppLogger;
    intervalMs?: number;
}) {
    const leaseOwner = `reaction-role-worker:${randomUUID()}`;
    const abortController = new AbortController();
    let stopped = false;
    let running: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wakePending = false;
    let drainCapacityReached = false;
    let reconciliationRunning: Promise<void> | undefined;
    const isStopped = () => stopped;

    const schedule = (delay: number) => {
        if (stopped) return;
        timer = setTimeout(() => {
            timer = undefined;
            start();
        }, delay);
    };
    const start = () => {
        if (stopped || running) {
            if (running) wakePending = true;
            return;
        }
        drainCapacityReached = false;
        running = (async () => {
            for (let index = 0; index < maxOperationsPerDrain; index += 1) {
                if (isStopped()) return;
                const result = await runNextReactionRoleOperation(input.context, {
                    leaseOwner,
                    signal: abortController.signal,
                });
                if (result.status === 'idle') return;
                input.logger.info('reaction_roles.operation_completed', result);
                if (result.status === 'unknown' || result.status === 'permanent_failure') {
                    input.logger.error('reaction_roles.operation_requires_attention', result);
                }
                if (result.status === 'deferred' && result.operationId === 'unknown') return;
            }
            drainCapacityReached = !stopped;
        })()
            .catch((error: unknown) => {
                input.logger.error('reaction_roles.worker_failed', {
                    errorType: error instanceof Error ? error.name : typeof error,
                });
            })
            .finally(() => {
                running = undefined;
                if (wakePending && !stopped) {
                    wakePending = false;
                    queueMicrotask(start);
                } else if (drainCapacityReached && !stopped) {
                    queueMicrotask(start);
                } else {
                    schedule(input.intervalMs ?? idleDelayMs);
                }
            });
    };
    const reconcile = () => {
        if (stopped || reconciliationRunning) return;
        reconciliationRunning = reconcileReactionRolePanels(input.context, input.logger, abortController.signal)
            .then((changedUserCount) => {
                if (changedUserCount > 0) {
                    input.logger.info('reaction_roles.reconciliation_completed', { changedUserCount });
                    start();
                }
            })
            .catch((error: unknown) => {
                input.logger.error('reaction_roles.reconciliation_failed', {
                    errorType: error instanceof Error ? error.name : typeof error,
                });
            })
            .finally(() => {
                reconciliationRunning = undefined;
            });
    };
    start();
    reconcile();
    const reconciliationTimer = setInterval(reconcile, reconciliationIntervalMs);

    return {
        wake() {
            if (stopped) return;
            if (timer) clearTimeout(timer);
            timer = undefined;
            start();
        },
        async stop() {
            stopped = true;
            abortController.abort();
            clearInterval(reconciliationTimer);
            wakePending = false;
            if (timer) clearTimeout(timer);
            timer = undefined;
            const drained = await waitForDrain([running, reconciliationRunning]);
            if (!drained) input.logger.warn('reaction_roles.shutdown_drain_timed_out');
        },
    };
}

async function waitForDrain(tasks: Array<Promise<void> | undefined>): Promise<boolean> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), shutdownDrainTimeoutMs);
        const pendingTasks = tasks.filter((task): task is Promise<void> => task !== undefined);
        void Promise.allSettled(pendingTasks).then(() => {
            clearTimeout(timeout);
            resolve(true);
        });
    });
}
