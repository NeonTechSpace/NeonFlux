import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { AppLogger } from '@neonflux/core/logging';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { runNextDashboardPostingOperation, type DashboardPostingWorkerResult } from './bot-posting-worker.js';

const schedulerIdleDelaysMs = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
const maxWorkItemsPerSlice = 20;
const defaultItemDeadlineMs = 20_000;
const defaultShutdownGraceMs = 5_000;

type DrainTrigger = 'poll' | 'startup' | 'wake';
type DrainStopReason = 'claim_failure' | 'deadline' | 'exception' | 'idle' | 'shutdown';

type DrainStats = {
    claimed: number;
    deferred: number;
    permanentFailure: number;
    sent: number;
    slices: number;
    unknown: number;
};

type SliceResult =
    | { type: 'batch-exhausted' }
    | { reason: 'claim_failure' | 'deadline'; type: 'halted' }
    | { type: 'idle' }
    | { type: 'shutdown' };

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
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let idleCount = 0;
    let activeController: AbortController | undefined;
    let continuation: ReturnType<typeof setImmediate> | undefined;
    let resolveContinuation: ((shouldContinue: boolean) => void) | undefined;

    const runSlice = async (stats: DrainStats): Promise<SliceResult> => {
        for (let index = 0; index < maxWorkItemsPerSlice; index += 1) {
            if (stopped) return { type: 'shutdown' };
            const controller = new AbortController();
            activeController = controller;
            let result: DashboardPostingWorkerResult | 'deadline' | 'shutdown';
            try {
                result = await runWithAbortDeadline(
                    runNextDashboardPostingOperation(input.context, { leaseOwner, signal: controller.signal }),
                    controller,
                    input.itemDeadlineMs ?? defaultItemDeadlineMs
                );
            } finally {
                if (activeController === controller) activeController = undefined;
            }
            if (result === 'shutdown') return { type: 'shutdown' };
            if (result === 'deadline') {
                input.logger.error('posting.worker_deadline_exceeded', { stage: 'operation' });
                return { reason: 'deadline', type: 'halted' };
            }
            if (result.status === 'idle') return { type: 'idle' };
            if (result.status === 'deferred' && result.operationId === 'unknown') {
                input.logger.error('posting.worker_claim_failed', { errorCode: result.errorCode });
                return { reason: 'claim_failure', type: 'halted' };
            }

            recordOperationResult(stats, result);
            input.logger.info('posting.operation_timing', {
                ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
                ...(result.timings ?? {}),
                attemptCount: result.attemptCount,
                operationId: result.operationId,
                outcome: result.status,
            });
            if (result.status === 'unknown' || result.status === 'permanent_failure') {
                input.logger.error('posting.operation_requires_attention', {
                    errorCode: result.errorCode,
                    operationId: result.operationId,
                    status: result.status,
                });
            }
        }
        return { type: 'batch-exhausted' };
    };

    const yieldToEventLoop = () =>
        new Promise<boolean>((resolve) => {
            resolveContinuation = resolve;
            continuation = setImmediate(() => {
                continuation = undefined;
                resolveContinuation = undefined;
                resolve(true);
            });
        });

    const runDrain = async (trigger: DrainTrigger): Promise<{ claimed: number; stopReason: DrainStopReason }> => {
        const startedAt = performance.now();
        const stats: DrainStats = {
            claimed: 0,
            deferred: 0,
            permanentFailure: 0,
            sent: 0,
            slices: 0,
            unknown: 0,
        };
        let stopReason: DrainStopReason = 'idle';
        try {
            while (!stopped) {
                stats.slices += 1;
                const slice = await runSlice(stats);
                if (slice.type === 'batch-exhausted') {
                    if (!(await yieldToEventLoop())) {
                        stopReason = 'shutdown';
                        break;
                    }
                    continue;
                }
                stopReason = slice.type === 'halted' ? slice.reason : slice.type;
                break;
            }
            if (stopped) stopReason = 'shutdown';
        } catch (error: unknown) {
            stopReason = 'exception';
            input.logger.error('posting.worker_failed', {
                errorType: error instanceof Error ? error.name : typeof error,
            });
        } finally {
            if (stats.claimed > 0 || stopReason !== 'idle') {
                input.logger.info('posting.drain_cycle', {
                    claimed: stats.claimed,
                    deferred: stats.deferred,
                    durationMs: elapsedMilliseconds(startedAt),
                    permanentFailure: stats.permanentFailure,
                    sent: stats.sent,
                    slices: stats.slices,
                    stopReason,
                    trigger,
                    unknown: stats.unknown,
                });
            }
        }
        return { claimed: stats.claimed, stopReason };
    };

    const configuredIntervalMs = input.intervalMs;
    const schedulePoll = (delayMs: number) => {
        if (stopped) return;
        const jitteredDelay = configuredIntervalMs === undefined ? jitterWorkerDelay(delayMs) : delayMs;
        pollTimer = setTimeout(() => {
            pollTimer = undefined;
            startRun('poll');
        }, jitteredDelay);
    };
    const startRun = (trigger: DrainTrigger) => {
        if (running || stopped) return;
        let nextDelayMs = configuredIntervalMs ?? schedulerIdleDelaysMs[0];
        running = runDrain(trigger)
            .then((result) => {
                if (configuredIntervalMs !== undefined) return;
                if (result.claimed === 0 && result.stopReason === 'idle') {
                    idleCount += 1;
                    nextDelayMs =
                        schedulerIdleDelaysMs[Math.min(idleCount - 1, schedulerIdleDelaysMs.length - 1)] ??
                        schedulerIdleDelaysMs[0];
                    return;
                }
                idleCount = 0;
                nextDelayMs = schedulerIdleDelaysMs[0];
            })
            .finally(() => {
                running = undefined;
                if (wakePending && !stopped) {
                    wakePending = false;
                    idleCount = 0;
                    queueMicrotask(() => startRun('wake'));
                    return;
                }
                schedulePoll(nextDelayMs);
            });
    };
    startRun('startup');

    return {
        wake(): void {
            if (stopped) return;
            if (running) {
                wakePending = true;
                return;
            }
            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = undefined;
            }
            idleCount = 0;
            startRun('wake');
        },
        async stop(): Promise<void> {
            stopped = true;
            wakePending = false;
            if (pollTimer) clearTimeout(pollTimer);
            pollTimer = undefined;
            if (continuation) clearImmediate(continuation);
            continuation = undefined;
            const continuationResolver = resolveContinuation;
            resolveContinuation = undefined;
            continuationResolver?.(false);
            activeController?.abort('shutdown');
            if (!running) return;
            await waitForShutdown(running, input.shutdownGraceMs ?? defaultShutdownGraceMs);
        },
    };
}

function jitterWorkerDelay(delayMs: number): number {
    return Math.max(1, Math.round(delayMs * (0.9 + Math.random() * 0.2)));
}

function recordOperationResult(
    stats: DrainStats,
    result: Exclude<DashboardPostingWorkerResult, { status: 'idle' }>
): void {
    stats.claimed += 1;
    if (result.status === 'sent') stats.sent += 1;
    else if (result.status === 'deferred') stats.deferred += 1;
    else if (result.status === 'permanent_failure') stats.permanentFailure += 1;
    else stats.unknown += 1;
}

function elapsedMilliseconds(startedAt: number): number {
    const elapsed = performance.now() - startedAt;
    return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0;
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
