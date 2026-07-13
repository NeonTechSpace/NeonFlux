import { randomUUID } from 'node:crypto';

import {
    claimNextDashboardPostingOperation,
    completeDashboardPostingOperationSent,
    deferDashboardPostingOperationBeforeSend,
    failDashboardPostingOperationPermanently,
    isDashboardPostingGuildRunnable,
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
    | { operationId: string; status: 'sent' }
    | { errorCode: string; operationId: string; status: 'deferred' | 'permanent_failure' | 'unknown' };

const leaseTtlMs = 60_000;
const retryDelayMs = 2_000;
const maxRetryDelayMs = 60_000;
const maxPreSendAttempts = 5;
const postableChannelTypes = new Set([0, 5]);

export async function runNextDashboardPostingOperation(
    context: BotFeatureHandlerContext,
    options: { leaseOwner: string; now?: Date }
): Promise<DashboardPostingWorkerResult> {
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
    if (operation.externalMessageId && operation.externalChannelId) {
        return finalizeSent(context, operation, leaseId, now);
    }

    const payload = normalizeDashboardPostingPayload({
        ...(operation.content ? { content: operation.content } : {}),
        embeds: operation.embeds,
    });
    if (payload.isErr()) return fail(context, operation, leaseId, now, 'invalid_persisted_payload');

    const runnable = await isDashboardPostingGuildRunnable(context.db, { guildId: operation.guildId });
    if (runnable.isErr()) return defer(context, operation, leaseId, now, 'scope_check_failed');
    if (!runnable.value) return fail(context, operation, leaseId, now, 'guild_out_of_scope');

    const platform = createFluxerPlatform(context.client);
    const structure = await platform.guildStructure.read({ guildId: operation.guildId });
    if (structure.isErr()) {
        return structure.error.type === 'missing-input'
            ? fail(context, operation, leaseId, now, 'guild_preflight_invalid')
            : defer(context, operation, leaseId, now, 'guild_preflight_failed');
    }
    const channel = structure.value.channels.find((candidate) => candidate.id === operation.requestedChannelId);
    if (!channel || !postableChannelTypes.has(channel.type)) {
        return fail(context, operation, leaseId, now, 'channel_not_postable');
    }

    const sendStarted = await markDashboardPostingOperationSendStarted(context.db, {
        leaseId,
        now: new Date(),
        operationId: operation.id,
    });
    if (sendStarted.isErr() || !sendStarted.value) {
        return { errorCode: 'send_start_persistence_failed', operationId: operation.id, status: 'deferred' };
    }

    const sent = await platform.messages.send({
        allowedMentions: { parse: [] },
        channelId: operation.requestedChannelId,
        ...(payload.value.content ? { content: payload.value.content } : {}),
        ...(payload.value.embeds.length > 0
            ? { embeds: payload.value.embeds as Parameters<typeof platform.messages.send>[0]['embeds'] }
            : {}),
    });
    if (sent.isErr()) {
        await markDashboardPostingOperationUnknown(context.db, {
            ...(channel.name ? { channelName: channel.name } : {}),
            errorCode: 'send_outcome_unknown',
            leaseId,
            now: new Date(),
            operationId: operation.id,
        });
        return { errorCode: 'send_outcome_unknown', operationId: operation.id, status: 'unknown' };
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

    return finalizeSent(context, persisted, leaseId, new Date(), channel.name ?? undefined);
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
