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

export type DashboardPostingWorkerResult =
    | { status: 'idle' }
    | { operationId: string; status: 'sent'; timings?: DashboardPostingTimings }
    | { errorCode: string; operationId: string; status: 'deferred' | 'permanent_failure' | 'unknown' };

const leaseTtlMs = 60_000;
const retryDelayMs = 2_000;
const maxRetryDelayMs = 60_000;
const maxPreSendAttempts = 5;
const postableChannelTypes = new Set([0]);

type DashboardPostingTimings = {
    preflightMs: number;
    providerSendMs: number;
    queueWaitMs: number;
    totalMs: number;
};

export async function runNextDashboardPostingOperation(
    context: BotFeatureHandlerContext,
    options: { leaseOwner: string; now?: Date; signal?: AbortSignal }
): Promise<DashboardPostingWorkerResult> {
    const totalStartedAt = performance.now();
    if (options.signal?.aborted) return { errorCode: 'worker_aborted', operationId: 'unknown', status: 'deferred' };
    const now = options.now ?? new Date();
    const leaseId = randomUUID();
    const claim = await claimNextDashboardPostingOperation(context.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        leaseOwner: options.leaseOwner,
        now,
    });
    if (claim.isErr()) return { errorCode: 'database_error', operationId: 'unknown', status: 'deferred' };
    if (!claim.value) return { status: 'idle' };

    const operation = claim.value;
    const queueWaitMs = Math.max(0, now.getTime() - operation.createdAt.getTime());
    if (options.signal?.aborted) return defer(context, operation, leaseId, new Date(), 'worker_aborted_before_send');
    if (operation.externalMessageId && operation.externalChannelId) {
        return finalizeSent(context, operation, leaseId, now);
    }

    const payload = normalizeDashboardPostingPayload({
        ...(operation.content ? { content: operation.content } : {}),
        embeds: operation.embeds,
    });
    if (payload.isErr()) return fail(context, operation, leaseId, now, 'invalid_persisted_payload');

    const platform = createFluxerPlatform(context.client);
    const preflightStartedAt = performance.now();
    const target = await platform.messages.resolveDashboardTarget({ channelId: operation.requestedChannelId });
    if (options.signal?.aborted) return defer(context, operation, leaseId, new Date(), 'worker_aborted_before_send');
    if (target.isErr()) {
        if (target.error.type === 'not-found') {
            return fail(context, operation, leaseId, now, 'channel_not_postable');
        }
        return target.error.type === 'missing-input'
            ? fail(context, operation, leaseId, now, 'guild_preflight_invalid')
            : defer(context, operation, leaseId, now, 'guild_preflight_failed');
    }
    const channel = target.value;
    if (channel.guildId !== operation.guildId || !postableChannelTypes.has(channel.type)) {
        return fail(context, operation, leaseId, now, 'channel_not_postable');
    }
    const preflightMs = performance.now() - preflightStartedAt;

    const sendStarted = await markDashboardPostingOperationSendStarted(context.db, {
        leaseId,
        now: new Date(),
        operationId: operation.id,
    });
    if (sendStarted.isErr() || !sendStarted.value) {
        return { errorCode: 'send_start_persistence_failed', operationId: operation.id, status: 'deferred' };
    }

    if (options.signal?.aborted) {
        return markUnknown(context, operation, leaseId, channel.name ?? undefined, 'worker_deadline_after_send_start');
    }

    const providerSendStartedAt = performance.now();
    const sent = await waitForProviderSend(
        platform.messages.sendDashboard({
            channelId: operation.requestedChannelId,
            message: payload.value,
        }),
        options.signal
    );
    const providerSendMs = performance.now() - providerSendStartedAt;
    if (sent === 'aborted') {
        return markUnknown(
            context,
            operation,
            leaseId,
            channel.name ?? undefined,
            'send_outcome_unknown_after_deadline'
        );
    }
    if (sent.isErr()) {
        return markUnknown(context, operation, leaseId, channel.name ?? undefined, 'send_outcome_unknown');
    }

    const persisted = await persistExternalMessage(context, operation, leaseId, sent.value);
    if (!persisted) {
        await markDashboardPostingOperationUnknown(context.db, {
            ...(channel.name ? { channelName: channel.name } : {}),
            errorCode: 'sent_message_persistence_unknown',
            leaseId,
            now: new Date(),
            operationId: operation.id,
        });
        return { errorCode: 'sent_message_persistence_unknown', operationId: operation.id, status: 'unknown' };
    }

    const finalized = await finalizeSent(context, persisted, leaseId, new Date(), channel.name ?? undefined);
    return finalized.status === 'sent'
        ? {
              ...finalized,
              timings: {
                  preflightMs: roundedMilliseconds(preflightMs),
                  providerSendMs: roundedMilliseconds(providerSendMs),
                  queueWaitMs: roundedMilliseconds(queueWaitMs),
                  totalMs: roundedMilliseconds(performance.now() - totalStartedAt),
              },
          }
        : finalized;
}

function roundedMilliseconds(value: number): number {
    return Math.max(0, Math.round(value));
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
): Promise<DashboardPostingWorkerResult> {
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
): Promise<DashboardPostingWorkerResult> {
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
): Promise<DashboardPostingWorkerResult> {
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
): Promise<DashboardPostingWorkerResult> {
    await failDashboardPostingOperationPermanently(context.db, {
        errorCode,
        leaseId,
        now,
        operationId: operation.id,
    });
    return { errorCode, operationId: operation.id, status: 'permanent_failure' };
}
