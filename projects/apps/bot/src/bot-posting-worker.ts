import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
    claimNextDashboardPostingOperation,
    completeDashboardPostingOperationSent,
    deferDashboardPostingOperationBeforeSend,
    failDashboardPostingOperationPermanently,
    markDashboardPostingOperationSendStarted,
    markDashboardPostingOperationUnknown,
    normalizeDashboardPostingPayload,
    readDashboardPostingOperationForWorker,
    recordDashboardPostingOperationExternalMessage,
    type DashboardPostingOperationWorkerRecord,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer/platform';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';

type DashboardPostingTransitionResult =
    | { errorCode?: never; operationId: string; status: 'sent' }
    | { errorCode: string; operationId: string; status: 'deferred' | 'permanent_failure' | 'unknown' };

export type DashboardPostingWorkerResult =
    | { status: 'idle' }
    | ({ attemptCount: number; timings: DashboardPostingTimings } & DashboardPostingTransitionResult)
    | {
          attemptCount?: never;
          errorCode: string;
          operationId: 'unknown';
          status: 'deferred';
          timings?: never;
      };

const leaseTtlMs = 60_000;
const retryDelayMs = 2_000;
const maxRetryDelayMs = 60_000;
const maxPreSendAttempts = 5;
const postableChannelTypes = new Set([0]);

type DashboardPostingTimings = {
    claimMs: number;
    completionPersistenceMs?: number;
    deliveryTotalMs?: number;
    operationAgeMs: number;
    preflightMs?: number;
    providerAcceptedAtMs?: number;
    providerSendMs?: number;
    queueWaitMs: number;
    receiptPersistenceMs?: number;
    sendStartPersistenceMs?: number;
    workerTotalMs: number;
};

type WorkerTimingState = Partial<
    Pick<
        DashboardPostingTimings,
        'completionPersistenceMs' | 'preflightMs' | 'providerSendMs' | 'receiptPersistenceMs' | 'sendStartPersistenceMs'
    >
> & {
    claimMs: number;
    queueWaitMs: number;
    totalStartedAt: number;
};

export async function runNextDashboardPostingOperation(
    context: BotFeatureHandlerContext,
    options: { leaseOwner: string; now?: Date; signal?: AbortSignal }
): Promise<DashboardPostingWorkerResult> {
    const totalStartedAt = performance.now();
    if (options.signal?.aborted) return { errorCode: 'worker_aborted', operationId: 'unknown', status: 'deferred' };
    const now = options.now ?? new Date();
    const leaseId = randomUUID();
    const claimStartedAt = performance.now();
    const claim = await claimNextDashboardPostingOperation(context.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        leaseOwner: options.leaseOwner,
        now,
    });
    const claimMs = elapsedMilliseconds(claimStartedAt);
    if (claim.isErr()) return { errorCode: 'database_error', operationId: 'unknown', status: 'deferred' };
    if (!claim.value) return { status: 'idle' };

    const operation = claim.value;
    const timingState: WorkerTimingState = {
        claimMs,
        queueWaitMs: roundedMilliseconds(now.getTime() - operation.createdAt.getTime()),
        totalStartedAt,
    };
    if (options.signal?.aborted) {
        return withTimings(
            await recordCompletionPersistence(timingState, () =>
                defer(context, operation, leaseId, new Date(), 'worker_aborted_before_send')
            ),
            operation,
            timingState
        );
    }
    if (operation.externalMessageId && operation.externalChannelId) {
        const result = await recordCompletionPersistence(timingState, () =>
            finalizeSent(context, operation, leaseId, now)
        );
        return withTimings(result, operation, timingState);
    }

    const payload = normalizeDashboardPostingPayload({
        ...(operation.content ? { content: operation.content } : {}),
        embeds: operation.embeds,
    });
    if (payload.isErr()) {
        return withTimings(
            await recordCompletionPersistence(timingState, () =>
                fail(context, operation, leaseId, now, 'invalid_persisted_payload')
            ),
            operation,
            timingState
        );
    }

    const platform = createFluxerPlatform(context.client);
    const preflightStartedAt = performance.now();
    const target = await platform.messages.resolveDashboardTarget({ channelId: operation.requestedChannelId });
    timingState.preflightMs = elapsedMilliseconds(preflightStartedAt);
    if (options.signal?.aborted) {
        return withTimings(
            await recordCompletionPersistence(timingState, () =>
                defer(context, operation, leaseId, new Date(), 'worker_aborted_before_send')
            ),
            operation,
            timingState
        );
    }
    if (target.isErr()) {
        if (target.error.type === 'not-found') {
            return withTimings(
                await recordCompletionPersistence(timingState, () =>
                    fail(context, operation, leaseId, now, 'channel_not_postable')
                ),
                operation,
                timingState
            );
        }
        const result = await recordCompletionPersistence(timingState, () =>
            target.error.type === 'missing-input'
                ? fail(context, operation, leaseId, now, 'guild_preflight_invalid')
                : defer(context, operation, leaseId, now, 'guild_preflight_failed')
        );
        return withTimings(result, operation, timingState);
    }
    const channel = target.value;
    if (channel.guildId !== operation.guildId || !postableChannelTypes.has(channel.type)) {
        return withTimings(
            await recordCompletionPersistence(timingState, () =>
                fail(context, operation, leaseId, now, 'channel_not_postable')
            ),
            operation,
            timingState
        );
    }

    const sendStartPersistenceStartedAt = performance.now();
    const sendStarted = await markDashboardPostingOperationSendStarted(context.db, {
        leaseId,
        now: new Date(),
        operationId: operation.id,
    });
    timingState.sendStartPersistenceMs = elapsedMilliseconds(sendStartPersistenceStartedAt);
    if (sendStarted.isErr() || !sendStarted.value) {
        return withTimings(
            { errorCode: 'send_start_persistence_failed', operationId: operation.id, status: 'deferred' },
            operation,
            timingState
        );
    }

    if (options.signal?.aborted) {
        return withTimings(
            await recordCompletionPersistence(timingState, () =>
                markUnknown(context, operation, leaseId, channel.name ?? undefined, 'worker_deadline_after_send_start')
            ),
            operation,
            timingState
        );
    }

    const providerSendStartedAt = performance.now();
    const sent = await waitForProviderSend(
        platform.messages.sendDashboard({
            allowMassMentions: operation.allowMassMentions,
            channelId: operation.requestedChannelId,
            message: payload.value,
        }),
        options.signal
    );
    timingState.providerSendMs = elapsedMilliseconds(providerSendStartedAt);
    if (sent === 'aborted') {
        return withTimings(
            await recordCompletionPersistence(timingState, () =>
                markUnknown(
                    context,
                    operation,
                    leaseId,
                    channel.name ?? undefined,
                    'send_outcome_unknown_after_deadline'
                )
            ),
            operation,
            timingState
        );
    }
    if (sent.isErr()) {
        return withTimings(
            await recordCompletionPersistence(timingState, () =>
                markUnknown(context, operation, leaseId, channel.name ?? undefined, 'send_outcome_unknown')
            ),
            operation,
            timingState
        );
    }
    const providerAcceptedAtMs = Date.now();

    const receiptPersistenceStartedAt = performance.now();
    const persisted = await persistExternalMessage(context, operation, leaseId, sent.value);
    timingState.receiptPersistenceMs = elapsedMilliseconds(receiptPersistenceStartedAt);
    if (!persisted) {
        const result = await recordCompletionPersistence(timingState, () =>
            markUnknown(context, operation, leaseId, channel.name ?? undefined, 'sent_message_persistence_unknown')
        );
        return withTimings(result, operation, timingState, providerAcceptedAtMs);
    }

    const finalized = await recordCompletionPersistence(timingState, () =>
        finalizeSent(context, persisted, leaseId, new Date(), channel.name ?? undefined)
    );
    return withTimings(finalized, operation, timingState, providerAcceptedAtMs);
}

function roundedMilliseconds(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function elapsedMilliseconds(startedAt: number): number {
    return roundedMilliseconds(performance.now() - startedAt);
}

async function recordCompletionPersistence(
    state: WorkerTimingState,
    transition: () => Promise<DashboardPostingTransitionResult>
): Promise<DashboardPostingTransitionResult> {
    const startedAt = performance.now();
    try {
        return await transition();
    } finally {
        state.completionPersistenceMs = elapsedMilliseconds(startedAt);
    }
}

function withTimings(
    result: DashboardPostingTransitionResult,
    operation: DashboardPostingOperationWorkerRecord,
    state: WorkerTimingState,
    providerAcceptedAtMs?: number
): DashboardPostingWorkerResult {
    const completedAtMs = Date.now();
    const timings: DashboardPostingTimings = {
        claimMs: state.claimMs,
        operationAgeMs: roundedMilliseconds(completedAtMs - operation.createdAt.getTime()),
        queueWaitMs: state.queueWaitMs,
        workerTotalMs: elapsedMilliseconds(state.totalStartedAt),
        ...(state.completionPersistenceMs === undefined
            ? {}
            : { completionPersistenceMs: state.completionPersistenceMs }),
        ...(state.preflightMs === undefined ? {} : { preflightMs: state.preflightMs }),
        ...(state.providerSendMs === undefined ? {} : { providerSendMs: state.providerSendMs }),
        ...(state.receiptPersistenceMs === undefined ? {} : { receiptPersistenceMs: state.receiptPersistenceMs }),
        ...(state.sendStartPersistenceMs === undefined ? {} : { sendStartPersistenceMs: state.sendStartPersistenceMs }),
        ...(providerAcceptedAtMs === undefined
            ? {}
            : {
                  deliveryTotalMs: roundedMilliseconds(providerAcceptedAtMs - operation.createdAt.getTime()),
                  providerAcceptedAtMs,
              }),
    };
    return {
        ...result,
        attemptCount: operation.attemptCount,
        timings,
    };
}

async function waitForProviderSend<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | 'aborted'> {
    if (!signal) return promise;
    if (signal.aborted) {
        void promise.catch(() => undefined);
        return 'aborted';
    }
    let removeAbortListener: () => void = () => undefined;
    const aborted = new Promise<'aborted'>((resolve) => {
        const onAbort = () => resolve('aborted');
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });
    try {
        const result = await Promise.race([promise, aborted]);
        if (result === 'aborted') void promise.catch(() => undefined);
        return result;
    } finally {
        removeAbortListener();
    }
}

async function markUnknown(
    context: BotFeatureHandlerContext,
    operation: DashboardPostingOperationWorkerRecord,
    leaseId: string,
    channelName: string | undefined,
    errorCode: string
): Promise<DashboardPostingTransitionResult> {
    await markDashboardPostingOperationUnknown(context.db, {
        ...(channelName ? { channelName } : {}),
        errorCode,
        leaseId,
        now: new Date(),
        operationId: operation.id,
    });
    return { errorCode, operationId: operation.id, status: 'unknown' };
}

async function persistExternalMessage(
    context: BotFeatureHandlerContext,
    operation: DashboardPostingOperationWorkerRecord,
    leaseId: string,
    sent: { channelId: string; id: string }
): Promise<DashboardPostingOperationWorkerRecord | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const recorded = await recordDashboardPostingOperationExternalMessage(context.db, {
            externalChannelId: sent.channelId,
            externalMessageId: sent.id,
            leaseId,
            now: new Date(),
            operationId: operation.id,
        });
        if (recorded.isOk() && recorded.value) return recorded.value;
    }
    const readback = await readDashboardPostingOperationForWorker(context.db, { operationId: operation.id });
    return readback.isOk() && readback.value?.externalMessageId === sent.id ? readback.value : null;
}

async function finalizeSent(
    context: BotFeatureHandlerContext,
    operation: DashboardPostingOperationWorkerRecord,
    leaseId: string,
    now: Date,
    channelName?: string
): Promise<DashboardPostingTransitionResult> {
    const completed = await completeDashboardPostingOperationSent(context.db, {
        ...(channelName ? { channelName } : {}),
        leaseId,
        now,
        operationId: operation.id,
    });
    if (completed.isOk() && completed.value?.status === 'sent') {
        return { operationId: operation.id, status: 'sent' };
    }
    const readback = await readDashboardPostingOperationForWorker(context.db, { operationId: operation.id });
    if (readback.isOk() && readback.value?.status === 'sent') return { operationId: operation.id, status: 'sent' };
    return { errorCode: 'completion_persistence_failed', operationId: operation.id, status: 'deferred' };
}

async function defer(
    context: BotFeatureHandlerContext,
    operation: DashboardPostingOperationWorkerRecord,
    leaseId: string,
    now: Date,
    errorCode: string
): Promise<DashboardPostingTransitionResult> {
    if (operation.attemptCount >= maxPreSendAttempts) {
        return fail(context, operation, leaseId, now, `${errorCode}_retry_exhausted`);
    }
    const delay = Math.min(retryDelayMs * 2 ** Math.max(operation.attemptCount - 1, 0), maxRetryDelayMs);
    await deferDashboardPostingOperationBeforeSend(context.db, {
        errorCode,
        leaseId,
        nextAttemptAt: new Date(now.getTime() + delay),
        now,
        operationId: operation.id,
    });
    return { errorCode, operationId: operation.id, status: 'deferred' };
}

async function fail(
    context: BotFeatureHandlerContext,
    operation: DashboardPostingOperationWorkerRecord,
    leaseId: string,
    now: Date,
    errorCode: string
): Promise<DashboardPostingTransitionResult> {
    await failDashboardPostingOperationPermanently(context.db, {
        errorCode,
        leaseId,
        now,
        operationId: operation.id,
    });
    return { errorCode, operationId: operation.id, status: 'permanent_failure' };
}
