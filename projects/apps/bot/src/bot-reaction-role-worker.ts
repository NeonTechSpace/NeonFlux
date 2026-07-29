import { randomUUID } from 'node:crypto';

import {
    advanceReactionRolePanelOperation,
    authorizeReactionRoleMemberEffect,
    claimNextReactionRoleMemberOperation,
    claimNextReactionRolePanelOperation,
    completeReactionRoleMemberOperation,
    completeReactionRolePanelOperation,
    deferReactionRoleMemberOperation,
    deferReactionRolePanelOperation,
    failReactionRolePanelOperation,
    pauseReactionRoleMemberOperation,
    pauseReactionRolePanelOperation,
    recordReactionRoleMemberBaseline,
    renewReactionRoleMemberOperationLease,
    renewReactionRolePanelOperationLease,
    requeueStaleReactionRoleMemberOperation,
    rollbackReactionRoleMemberOperation,
    yieldReactionRolePanelOperation,
    type ReactionRoleMemberWorkerRecord,
    type ReactionRolePanelWorkerRecord,
} from '@neonflux/db';
import { createFluxerReactionRolePlatform, type FluxerPlatformError } from '@neonflux/fluxer';
import { parseOutgoingMessage, type OutgoingMessage } from '@neonflux/messaging';
import { getReactionRoleEmojiKey, projectReactionRoleMessage, REACTION_ROLE_MARKER } from '@neonflux/reaction-roles';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { reactionRolesAllowed } from './bot-reaction-role-policy.js';

const leaseTtlMs = 60_000;
const maxAttempts = 5;
const maxCompletionChunksPerClaim = 10;
const pausedRetryDelayMs = 60_000;

export type ReactionRoleWorkerResult =
    | { status: 'idle' }
    | {
          errorCode?: string;
          operationId: string;
          operationType: 'member' | 'panel';
          status: 'completed' | 'deferred' | 'permanent_failure' | 'unknown';
      };

export async function runNextReactionRoleOperation(
    context: BotFeatureHandlerContext,
    input: { leaseOwner: string; signal?: AbortSignal }
): Promise<ReactionRoleWorkerResult> {
    if (input.signal?.aborted) return { status: 'idle' };
    const panel = await runNextPanelOperation(context, input);
    if (panel.status !== 'idle') return panel;
    if (input.signal?.aborted) return { status: 'idle' };
    return runNextMemberOperation(context, input);
}

async function runNextPanelOperation(
    context: BotFeatureHandlerContext,
    input: { leaseOwner: string; signal?: AbortSignal }
): Promise<ReactionRoleWorkerResult> {
    const now = new Date();
    const leaseId = randomUUID();
    const claim = await claimNextReactionRolePanelOperation(context.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        leaseOwner: input.leaseOwner,
        now,
    });
    if (claim.isErr()) return deferredUnknown('panel_claim_failed', 'panel');
    if (!claim.value) return { status: 'idle' };
    const operation = claim.value;
    if (!(await reactionRolesAllowed(context, operation.guildId))) {
        const pauseNow = new Date();
        const paused = await pauseReactionRolePanelOperation(context.db, {
            leaseId,
            nextAttemptAt: new Date(pauseNow.getTime() + pausedRetryDelayMs),
            now: pauseNow,
            operationId: operation.id,
        });
        return paused.isOk() && paused.value
            ? deferredOperation(operation.id, 'panel', 'defcon_paused')
            : deferredOperation(operation.id, 'panel', 'pause_persistence_failed');
    }
    if (
        operation.step === 'cleanup_completed' ||
        (operation.type === 'publish' && operation.step === 'reactions_seeded')
    ) {
        return completePanel(context, operation, leaseId);
    }
    if (!(await renewPanelLease(context, operation, leaseId))) {
        return deferredOperation(operation.id, 'panel', 'lease_renewal_failed');
    }
    if (operation.type === 'deactivate') {
        return deactivatePanel(context, operation, leaseId);
    }
    const platform = createFluxerReactionRolePlatform(context.client);
    const projected = projectReactionRoleMessage(operation.targetVersion.payload);
    if (projected.isErr()) return failPanel(context, operation, leaseId, 'invalid_persisted_payload', false);

    const preflight = await platform.preflight({
        channelId: operation.channelId,
        customEmojiIds: operation.targetVersion.payload.options.flatMap((option) =>
            option.emoji.kind === 'custom' ? [option.emoji.id] : []
        ),
        guildId: operation.guildId,
        roleIds: operation.targetVersion.payload.options.map((option) => option.roleId),
    });
    if (preflight.isErr()) {
        return handlePanelPlatformError(context, operation, leaseId, preflight.error, 'preflight_failed');
    }

    switch (operation.type) {
        case 'publish':
            return publishPanel(context, operation, leaseId, projected.value.message);
        case 'update':
            return updatePanel(context, operation, leaseId, projected.value.message);
    }
}

async function publishPanel(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string,
    message: OutgoingMessage
): Promise<ReactionRoleWorkerResult> {
    const platform = createFluxerReactionRolePlatform(context.client);
    let current = operation;
    if (!current.messageId) {
        if (current.step === 'message_send_started') {
            return failPanel(context, current, leaseId, 'send_outcome_unknown_after_restart', true);
        }
        const started = await advancePanel(context, current, leaseId, 'message_send_started');
        if (!started) return deferredOperation(current.id, 'panel', 'send_start_persistence_failed');
        current = started;
        const sent = await platform.send({ channelId: current.channelId, message, nonce: current.nonce });
        if (sent.isErr()) {
            return sent.error.type === 'operation-failed'
                ? failPanel(context, current, leaseId, 'send_outcome_unknown', true)
                : handlePanelPlatformError(context, current, leaseId, sent.error, 'message_send_failed');
        }
        const recorded = await advancePanel(context, current, leaseId, 'message_recorded', sent.value.id);
        if (!recorded) return failPanel(context, current, leaseId, 'message_receipt_persistence_failed', true);
        current = recorded;
    }
    const seeded = await seedReactions(context, current, leaseId);
    if (seeded.status !== 'completed') return seeded;
    return completePanel(context, current, leaseId);
}

async function updatePanel(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string,
    message: OutgoingMessage
): Promise<ReactionRoleWorkerResult> {
    if (!operation.messageId) return failPanel(context, operation, leaseId, 'managed_message_missing', false);
    const messageId = operation.messageId;
    const platform = createFluxerReactionRolePlatform(context.client);
    let current = operation;
    if (current.step === 'queued') {
        const seeded = await seedReactions(context, current, leaseId);
        if (seeded.status !== 'completed') return seeded;
    }
    if (current.step === 'queued' || current.step === 'reactions_seeded') {
        if (!(await renewPanelLease(context, current, leaseId))) {
            return deferredOperation(current.id, 'panel', 'lease_renewal_failed');
        }
        const edited = await platform.edit({
            channelId: current.channelId,
            message,
            messageId,
        });
        if (edited.isErr()) {
            return handlePanelPlatformError(
                context,
                current,
                leaseId,
                edited.error,
                edited.error.type === 'not-found' ? 'managed_message_deleted' : 'message_update_failed'
            );
        }
        const advanced = await advancePanel(context, current, leaseId, 'message_updated');
        if (!advanced) return deferredOperation(current.id, 'panel', 'update_persistence_failed');
        current = advanced;
    }
    const targetEmojiKeys = new Set(
        current.targetVersion.payload.options.map((option) => getReactionRoleEmojiKey(option.emoji))
    );
    for (const option of current.previousVersion?.payload.options ?? []) {
        if (targetEmojiKeys.has(getReactionRoleEmojiKey(option.emoji))) continue;
        if (!(await renewPanelLease(context, current, leaseId))) {
            return deferredOperation(current.id, 'panel', 'lease_renewal_failed');
        }
        const removed = await platform.removeReactionEmoji({
            channelId: current.channelId,
            emoji: option.emoji,
            messageId,
        });
        if (removed.isErr() && removed.error.type !== 'not-found') {
            return handlePanelPlatformError(
                context,
                current,
                leaseId,
                removed.error,
                'retired_reaction_cleanup_failed'
            );
        }
    }
    const cleanupCompleted = await advancePanel(context, current, leaseId, 'cleanup_completed');
    if (!cleanupCompleted) return deferredOperation(current.id, 'panel', 'cleanup_persistence_failed');
    return completePanel(context, cleanupCompleted, leaseId);
}

async function deactivatePanel(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string
): Promise<ReactionRoleWorkerResult> {
    if (!operation.messageId) return completePanel(context, operation, leaseId);
    const platform = createFluxerReactionRolePlatform(context.client);
    const cleanupStarted =
        operation.step === 'cleanup_started'
            ? operation
            : await advancePanel(context, operation, leaseId, 'cleanup_started');
    if (!cleanupStarted) return deferredOperation(operation.id, 'panel', 'cleanup_start_persistence_failed');
    if (!(await renewPanelLease(context, cleanupStarted, leaseId))) {
        return deferredOperation(operation.id, 'panel', 'lease_renewal_failed');
    }
    const reactionCleanup = await platform.removeAllReactions({
        channelId: operation.channelId,
        messageId: operation.messageId,
    });
    if (reactionCleanup.isErr() && reactionCleanup.error.type !== 'not-found') {
        return handlePanelPlatformError(context, operation, leaseId, reactionCleanup.error, 'reaction_cleanup_failed');
    }
    const messageResult = operation.deleteMessage
        ? await platform.delete({ channelId: operation.channelId, messageId: operation.messageId })
        : await editDeactivatedMessage(context, operation, operation.messageId);
    if (messageResult.isErr() && messageResult.error.type !== 'not-found') {
        return handlePanelPlatformError(context, operation, leaseId, messageResult.error, 'message_cleanup_failed');
    }
    const cleanupCompleted = await advancePanel(context, cleanupStarted, leaseId, 'cleanup_completed');
    if (!cleanupCompleted) return deferredOperation(operation.id, 'panel', 'cleanup_persistence_failed');
    return completePanel(context, cleanupCompleted, leaseId);
}

async function editDeactivatedMessage(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    messageId: string
) {
    const source = operation.targetVersion.payload;
    const content = source.content?.replaceAll(REACTION_ROLE_MARKER, '').trim();
    const embeds = source.embeds.map((embed) => ({
        ...embed,
        ...(embed.description === undefined
            ? {}
            : { description: embed.description.replaceAll(REACTION_ROLE_MARKER, '').trim() }),
    }));
    const parsed = parseOutgoingMessage({ ...(content ? { content } : {}), embeds });
    if (parsed.isErr()) {
        return createFluxerReactionRolePlatform(context.client).delete({
            channelId: operation.channelId,
            messageId,
        });
    }
    return createFluxerReactionRolePlatform(context.client).edit({
        channelId: operation.channelId,
        message: parsed.value,
        messageId,
    });
}

async function seedReactions(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string
): Promise<ReactionRoleWorkerResult> {
    if (!operation.messageId) return failPanel(context, operation, leaseId, 'managed_message_missing', false);
    const platform = createFluxerReactionRolePlatform(context.client);
    for (const option of operation.targetVersion.payload.options) {
        if (!(await renewPanelLease(context, operation, leaseId))) {
            return deferredOperation(operation.id, 'panel', 'lease_renewal_failed');
        }
        const result = await platform.react({
            channelId: operation.channelId,
            emoji: option.emoji,
            messageId: operation.messageId,
        });
        if (result.isErr()) {
            return handlePanelPlatformError(
                context,
                operation,
                leaseId,
                result.error,
                result.error.type === 'not-found' ? 'managed_message_deleted' : 'reaction_seed_failed'
            );
        }
    }
    const advanced = await advancePanel(context, operation, leaseId, 'reactions_seeded');
    return advanced
        ? { operationId: operation.id, operationType: 'panel', status: 'completed' }
        : deferredOperation(operation.id, 'panel', 'reaction_seed_persistence_failed');
}

async function completePanel(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string
): Promise<ReactionRoleWorkerResult> {
    for (let index = 0; index < maxCompletionChunksPerClaim; index += 1) {
        if (!(await renewPanelLease(context, operation, leaseId))) {
            return deferredOperation(operation.id, 'panel', 'lease_renewal_failed');
        }
        const completed = await completeReactionRolePanelOperation(context.db, {
            leaseId,
            now: new Date(),
            operationId: operation.id,
        });
        if (completed.isErr()) {
            return operation.attemptCount >= maxAttempts
                ? failPanel(context, operation, leaseId, 'completion_persistence_failed', false)
                : deferPanel(context, operation, leaseId, 'completion_persistence_failed');
        }
        if (completed.value === 'completed' || completed.value === 'stale') {
            return { operationId: operation.id, operationType: 'panel', status: 'completed' };
        }
    }
    const yielded = await yieldReactionRolePanelOperation(context.db, {
        leaseId,
        now: new Date(),
        operationId: operation.id,
    });
    return yielded.isOk() && yielded.value
        ? deferredOperation(operation.id, 'panel', 'completion_chunk_yielded')
        : deferredOperation(operation.id, 'panel', 'completion_persistence_failed');
}

async function runNextMemberOperation(
    context: BotFeatureHandlerContext,
    input: { leaseOwner: string; signal?: AbortSignal }
): Promise<ReactionRoleWorkerResult> {
    const now = new Date();
    const leaseId = randomUUID();
    const claim = await claimNextReactionRoleMemberOperation(context.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        leaseOwner: input.leaseOwner,
        now,
    });
    if (claim.isErr()) return deferredUnknown('member_claim_failed', 'member');
    if (!claim.value) return { status: 'idle' };
    if (!(await reactionRolesAllowed(context, claim.value.guildId))) {
        const pauseNow = new Date();
        const paused = await pauseReactionRoleMemberOperation(context.db, {
            leaseId,
            nextAttemptAt: new Date(pauseNow.getTime() + pausedRetryDelayMs),
            now: pauseNow,
            operationId: claim.value.id,
        });
        return paused.isOk() && paused.value
            ? deferredOperation(claim.value.id, 'member', 'defcon_paused')
            : deferredOperation(claim.value.id, 'member', 'pause_persistence_failed');
    }
    return applyMemberSelection(context, claim.value, leaseId);
}

async function applyMemberSelection(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleMemberWorkerRecord,
    leaseId: string
): Promise<ReactionRoleWorkerResult> {
    const platform = createFluxerReactionRolePlatform(context.client);
    if (!(await renewMemberLease(context, operation, leaseId))) {
        return deferredOperation(operation.id, 'member', 'lease_renewal_failed');
    }
    const memberRoles = await platform.readMemberRoleIds({ guildId: operation.guildId, userId: operation.userId });
    if (memberRoles.isErr()) {
        return handleMemberPlatformError(context, operation, leaseId, memberRoles.error, 'member_read_failed');
    }
    let currentOperation = operation;
    if (!currentOperation.baselineRoleIds) {
        const baseline = await recordReactionRoleMemberBaseline(context.db, {
            leaseId,
            now: new Date(),
            operationId: currentOperation.id,
            roleIds: memberRoles.value,
        });
        if (baseline.isErr() || !baseline.value) {
            const deferNow = new Date();
            const deferred = await deferReactionRoleMemberOperation(context.db, {
                errorCode: 'baseline_persistence_failed',
                leaseId,
                nextAttemptAt: retryAt(deferNow, currentOperation.attemptCount),
                now: deferNow,
                operationId: currentOperation.id,
            });
            return deferred.isOk() && deferred.value
                ? deferredOperation(currentOperation.id, 'member', 'baseline_persistence_failed')
                : deferredOperation(currentOperation.id, 'member', 'defer_persistence_failed');
        }
        currentOperation = baseline.value;
    }
    const baselineRoleIds = new Set(currentOperation.baselineRoleIds ?? memberRoles.value);
    const roleIds = new Set(memberRoles.value);
    const ownerships: Array<{ grantOwnership: 'panel' | 'preexisting'; optionId: string }> = [];
    for (const selection of currentOperation.desiredSelections) {
        if (roleIds.has(selection.roleId)) {
            ownerships.push({
                grantOwnership:
                    selection.grantOwnership === 'pending'
                        ? baselineRoleIds.has(selection.roleId)
                            ? 'preexisting'
                            : 'panel'
                        : selection.grantOwnership,
                optionId: selection.optionId,
            });
            continue;
        }
        if (!(await authorizeMemberEffect(context, currentOperation, leaseId))) {
            return deferredOperation(currentOperation.id, 'member', 'effect_fence_failed');
        }
        const added = await platform.addMemberRole({
            guildId: currentOperation.guildId,
            roleId: selection.roleId,
            userId: currentOperation.userId,
        });
        if (added.isErr()) {
            return handleMemberPlatformError(context, currentOperation, leaseId, added.error, 'role_add_failed', true);
        }
        roleIds.add(selection.roleId);
        ownerships.push({ grantOwnership: 'panel', optionId: selection.optionId });
    }
    const desiredOptionIds = new Set(currentOperation.desiredSelections.map((selection) => selection.optionId));
    for (const previous of currentOperation.previousSelections) {
        if (desiredOptionIds.has(previous.optionId)) continue;
        if (previous.grantOwnership === 'panel' && roleIds.has(previous.roleId)) {
            if (!(await authorizeMemberEffect(context, currentOperation, leaseId))) {
                return deferredOperation(currentOperation.id, 'member', 'effect_fence_failed');
            }
            const removed = await platform.removeMemberRole({
                guildId: currentOperation.guildId,
                roleId: previous.roleId,
                userId: currentOperation.userId,
            });
            if (removed.isErr() && removed.error.type !== 'not-found') {
                return handleMemberPlatformError(
                    context,
                    currentOperation,
                    leaseId,
                    removed.error,
                    'role_remove_failed'
                );
            }
            roleIds.delete(previous.roleId);
        }
        if (currentOperation.messageId) {
            if (!(await authorizeMemberEffect(context, currentOperation, leaseId))) {
                return deferredOperation(currentOperation.id, 'member', 'effect_fence_failed');
            }
            const reaction = await platform.removeUserReaction({
                channelId: currentOperation.channelId,
                emoji: previous.emoji,
                messageId: currentOperation.messageId,
                userId: currentOperation.userId,
            });
            if (reaction.isErr() && reaction.error.type !== 'not-found') {
                return handleMemberPlatformError(
                    context,
                    currentOperation,
                    leaseId,
                    reaction.error,
                    'reaction_cleanup_failed'
                );
            }
        }
    }
    const completed = await completeReactionRoleMemberOperation(context.db, {
        leaseId,
        now: new Date(),
        operationId: currentOperation.id,
        ownerships,
        revision: currentOperation.revision,
    });
    if (completed.isOk() && completed.value === 'stale') {
        const restored = await restoreMemberBaseline(context, currentOperation, leaseId);
        if (!restored) {
            const deferNow = new Date();
            const deferred = await deferReactionRoleMemberOperation(context.db, {
                errorCode: 'stale_baseline_restore_failed',
                leaseId,
                nextAttemptAt: retryAt(deferNow, currentOperation.attemptCount),
                now: deferNow,
                operationId: currentOperation.id,
            });
            return deferred.isOk() && deferred.value
                ? deferredOperation(currentOperation.id, 'member', 'stale_baseline_restore_failed')
                : deferredOperation(currentOperation.id, 'member', 'defer_persistence_failed');
        }
        const requeued = await requeueStaleReactionRoleMemberOperation(context.db, {
            leaseId,
            now: new Date(),
            operationId: currentOperation.id,
            revision: currentOperation.revision,
        });
        return requeued.isOk() && requeued.value
            ? deferredOperation(currentOperation.id, 'member', 'stale_revision_requeued')
            : deferredOperation(currentOperation.id, 'member', 'stale_requeue_persistence_failed');
    }
    return completed.isOk() && completed.value === 'completed'
        ? { operationId: currentOperation.id, operationType: 'member', status: 'completed' }
        : deferredOperation(currentOperation.id, 'member', 'completion_persistence_failed');
}

async function removeNewlyAddedReactions(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleMemberWorkerRecord
): Promise<void> {
    if (!operation.messageId) return;
    const platform = createFluxerReactionRolePlatform(context.client);
    for (const desired of operation.desiredSelections) {
        if (!operation.addedOptionIds.includes(desired.optionId)) continue;
        await platform.removeUserReaction({
            channelId: operation.channelId,
            emoji: desired.emoji,
            messageId: operation.messageId,
            userId: operation.userId,
        });
    }
}

async function advancePanel(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string,
    step: ReactionRolePanelWorkerRecord['step'],
    messageId?: string
) {
    const advanced = await advanceReactionRolePanelOperation(context.db, {
        leaseId,
        ...(messageId ? { messageId } : {}),
        now: new Date(),
        operationId: operation.id,
        step,
    });
    return advanced.isOk() ? advanced.value : null;
}

async function handlePanelPlatformError(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string,
    error: FluxerPlatformError,
    code: string
): Promise<ReactionRoleWorkerResult> {
    return isPermanent(error) || operation.attemptCount >= maxAttempts
        ? failPanel(context, operation, leaseId, code, false)
        : deferPanel(context, operation, leaseId, code);
}

async function handleMemberPlatformError(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleMemberWorkerRecord,
    leaseId: string,
    error: FluxerPlatformError,
    code: string,
    rollback = false
): Promise<ReactionRoleWorkerResult> {
    if (!isPermanent(error) && operation.attemptCount < maxAttempts) {
        const deferNow = new Date();
        const deferred = await deferReactionRoleMemberOperation(context.db, {
            errorCode: code,
            leaseId,
            nextAttemptAt: retryAt(deferNow, operation.attemptCount),
            now: deferNow,
            operationId: operation.id,
        });
        return deferred.isOk() && deferred.value
            ? deferredOperation(operation.id, 'member', code)
            : deferredOperation(operation.id, 'member', 'defer_persistence_failed');
    }
    if (rollback) await removeNewlyAddedReactions(context, operation);
    await restoreMemberBaseline(context, operation, leaseId);
    const rolledBack = await rollbackReactionRoleMemberOperation(context.db, {
        degradePanel: error.type !== 'not-found',
        errorCode: rollback ? code : `${code}_manual_review`,
        leaseId,
        now: new Date(),
        operationId: operation.id,
        revision: operation.revision,
    });
    return rolledBack.isOk() && rolledBack.value === 'rolled-back'
        ? { errorCode: code, operationId: operation.id, operationType: 'member', status: 'permanent_failure' }
        : deferredOperation(operation.id, 'member', 'rollback_persistence_failed');
}

async function restoreMemberBaseline(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleMemberWorkerRecord,
    leaseId: string
): Promise<boolean> {
    if (!operation.baselineRoleIds) return true;
    if (!(await renewMemberLease(context, operation, leaseId))) return false;
    const platform = createFluxerReactionRolePlatform(context.client);
    const current = await platform.readMemberRoleIds({ guildId: operation.guildId, userId: operation.userId });
    if (current.isErr()) return false;
    const baseline = new Set(operation.baselineRoleIds);
    const currentRoleIds = new Set(current.value);
    const touchedRoleIds = new Set([
        ...operation.desiredSelections.map((selection) => selection.roleId),
        ...operation.previousSelections.map((selection) => selection.roleId),
    ]);
    for (const roleId of touchedRoleIds) {
        if (!(await authorizeMemberEffect(context, operation, leaseId))) return false;
        if (baseline.has(roleId) && !currentRoleIds.has(roleId)) {
            const added = await platform.addMemberRole({
                guildId: operation.guildId,
                roleId,
                userId: operation.userId,
            });
            if (added.isErr()) return false;
        } else if (!baseline.has(roleId) && currentRoleIds.has(roleId)) {
            const removed = await platform.removeMemberRole({
                guildId: operation.guildId,
                roleId,
                userId: operation.userId,
            });
            if (removed.isErr() && removed.error.type !== 'not-found') return false;
        }
    }
    return true;
}

async function deferPanel(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string,
    errorCode: string
): Promise<ReactionRoleWorkerResult> {
    const deferNow = new Date();
    const deferred = await deferReactionRolePanelOperation(context.db, {
        errorCode,
        leaseId,
        nextAttemptAt: retryAt(deferNow, operation.attemptCount),
        now: deferNow,
        operationId: operation.id,
    });
    return deferred.isOk() && deferred.value
        ? deferredOperation(operation.id, 'panel', errorCode)
        : deferredOperation(operation.id, 'panel', 'defer_persistence_failed');
}

async function failPanel(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string,
    errorCode: string,
    unknown: boolean
): Promise<ReactionRoleWorkerResult> {
    const failed = await failReactionRolePanelOperation(context.db, {
        errorCode,
        leaseId,
        now: new Date(),
        operationId: operation.id,
        unknown,
    });
    if (failed.isErr() || !failed.value) {
        return deferredOperation(operation.id, 'panel', 'failure_persistence_failed');
    }
    return {
        errorCode,
        operationId: operation.id,
        operationType: 'panel',
        status: unknown ? 'unknown' : 'permanent_failure',
    };
}

function isPermanent(error: FluxerPlatformError): boolean {
    return (
        error.type === 'missing-input' ||
        error.type === 'invalid-value' ||
        error.type === 'not-found' ||
        error.type === 'permission-denied' ||
        error.type === 'unsupported'
    );
}

function deferredOperation(
    operationId: string,
    operationType: 'member' | 'panel',
    errorCode: string
): ReactionRoleWorkerResult {
    return { errorCode, operationId, operationType, status: 'deferred' };
}

function deferredUnknown(errorCode: string, operationType: 'member' | 'panel'): ReactionRoleWorkerResult {
    return deferredOperation('unknown', operationType, errorCode);
}

async function renewPanelLease(
    context: BotFeatureHandlerContext,
    operation: ReactionRolePanelWorkerRecord,
    leaseId: string
): Promise<boolean> {
    const now = new Date();
    const renewed = await renewReactionRolePanelOperationLease(context.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        now,
        operationId: operation.id,
    });
    return renewed.isOk() && renewed.value;
}

async function renewMemberLease(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleMemberWorkerRecord,
    leaseId: string
): Promise<boolean> {
    const now = new Date();
    const renewed = await renewReactionRoleMemberOperationLease(context.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        now,
        operationId: operation.id,
    });
    return renewed.isOk() && renewed.value;
}

async function authorizeMemberEffect(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleMemberWorkerRecord,
    leaseId: string
): Promise<boolean> {
    const now = new Date();
    const authorization = await authorizeReactionRoleMemberEffect(context.db, {
        leaseExpiresAt: new Date(now.getTime() + leaseTtlMs),
        leaseId,
        now,
        operationId: operation.id,
        panelGeneration: operation.panelGeneration,
        revision: operation.revision,
    });
    return authorization.isOk() && authorization.value === 'authorized';
}

function retryAt(now: Date, attemptCount: number): Date {
    const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attemptCount - 1));
    return new Date(now.getTime() + delayMs);
}
