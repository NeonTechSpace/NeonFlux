import { randomUUID } from 'node:crypto';

import type { AppLogger } from '@neonflux/core/logging';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { runNextDashboardPostingOperation } from './bot-posting-worker.js';

const schedulerIntervalMs = 2_000;
const maxWorkItemsPerRun = 20;
const defaultItemDeadlineMs = 20_000;
const defaultShutdownGraceMs = 5_000;

export function startDashboardPostingScheduler(input: {
    context: BotFeatureHandlerContext;
    logger: AppLogger;
    intervalMs?: number;
    itemDeadlineMs?: number;
    shutdownGraceMs?: number;
}) {
    const leaseOwner = `dashboard-posting-worker:${randomUUID()}`;
    let stopped = false;
    let wakePending = false;
    let running: Promise<void> | undefined;
    let activeController: AbortController | undefined;

    const runOnce = async () => {
        for (let index = 0; index < maxWorkItemsPerRun && !stopped; index += 1) {
            const controller = new AbortController();
            activeController = controller;
            const result = await runWithAbortDeadline(
                runNextDashboardPostingOperation(input.context, { leaseOwner, signal: controller.signal }),
                controller,
                input.itemDeadlineMs ?? defaultItemDeadlineMs
            );
            if (activeController === controller) activeController = undefined;
            if (result === 'deadline' || result === 'shutdown') {
                if (result === 'deadline') input.logger.error('posting.worker_deadline_exceeded', {});
                return;
            }
            if (result.status === 'idle') return;
            if (result.status === 'sent' && result.timings) {
                input.logger.info('posting.operation_timing', {
                    operationId: result.operationId,
                    ...result.timings,
                });
            }
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
                if (wakePending && !stopped) {
                    wakePending = false;
                    queueMicrotask(startRun);
                }
            });
    };
    const interval = setInterval(startRun, input.intervalMs ?? schedulerIntervalMs);
    startRun();

    return {
        wake(): void {
            if (stopped) return;
            if (running) {
                wakePending = true;
                return;
            }
            startRun();
        },
        async stop(): Promise<void> {
            stopped = true;
            wakePending = false;
            clearInterval(interval);
            activeController?.abort('shutdown');
            if (!running) return;
            await waitForShutdown(running, input.shutdownGraceMs ?? defaultShutdownGraceMs);
        },
    };
}

async function runWithAbortDeadline<T>(
    operation: Promise<T>,
    controller: AbortController,
    deadlineMs: number
): Promise<T | 'deadline' | 'shutdown'> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: () => void = () => undefined;
    const aborted = new Promise<'deadline' | 'shutdown'>((resolve) => {
        const onAbort = () => resolve(controller.signal.reason === 'shutdown' ? 'shutdown' : 'deadline');
        controller.signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => controller.signal.removeEventListener('abort', onAbort);
        timeout = setTimeout(() => controller.abort('deadline'), Math.max(1, deadlineMs));
    });
    const observedOperation = operation.catch((error: unknown) => {
        throw error;
    });
    try {
        const result = await Promise.race([observedOperation, aborted]);
        if (result === 'deadline' || result === 'shutdown') void observedOperation.catch(() => undefined);
        return result;
    } finally {
        if (timeout) clearTimeout(timeout);
        removeAbortListener();
    }
}

async function waitForShutdown(running: Promise<void>, graceMs: number): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            running,
            new Promise<void>((resolve) => {
                timeout = setTimeout(resolve, Math.max(1, graceMs));
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
        void running.catch(() => undefined);
    }
}
