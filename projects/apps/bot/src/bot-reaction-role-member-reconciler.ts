import { randomUUID } from 'node:crypto';

import {
    acquireReactionRoleUserLease,
    claimNextReactionRoleMemberState,
    completeReactionRoleMemberState,
    deferReactionRoleMemberState,
    hasOtherActiveReactionRoleAssignment,
    loadReactionRoleMemberReconciliation,
    releaseReactionRoleUserLease,
    renewReactionRoleUserLease,
    type ReactionRoleMemberStateRecord,
} from '@neonflux/db';
import { createFluxerPlatform, type FluxerPlatformError } from '@neonflux/fluxer';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { filterBotManageableRoleIds } from './bot-role-safety.js';

const memberLeaseTtlMs = 3 * 60_000;
const userLeaseTtlMs = 15 * 60_000;
const retryDelayMs = 5_000;
const blockedRetryDelayMs = 60 * 60_000;

export type ReactionRoleMemberReconcileResult =
    | { status: 'idle' }
    | { status: 'synced'; stateId: string }
    | { status: 'deferred' | 'blocked'; stateId: string; errorCode: string };

export async function runNextReactionRoleMemberReconciliation(
    context: BotFeatureHandlerContext,
    input: { leaseOwner: string; now?: Date }
): Promise<ReactionRoleMemberReconcileResult> {
    const now = input.now ?? new Date();
    const leaseId = randomUUID();
    const claim = await claimNextReactionRoleMemberState(context.db, {
        leaseExpiresAt: new Date(now.getTime() + memberLeaseTtlMs),
        leaseId,
        leaseOwner: input.leaseOwner,
        now,
    });
    if (claim.isErr()) return { status: 'deferred', stateId: 'unknown', errorCode: 'database_error' };
    if (!claim.value) return { status: 'idle' };
    const userLease = await acquireReactionRoleUserLease(context.db, {
        guildId: claim.value.guildId,
        leaseExpiresAt: new Date(now.getTime() + userLeaseTtlMs),
        leaseId,
        leaseOwner: input.leaseOwner,
        now,
        userId: claim.value.userId,
    });
    if (userLease.isErr() || !userLease.value) {
        return deferState(context, claim.value, leaseId, now, 'user_transition_active');
    }
    try {
        return await reconcileClaimedMemberState(context, claim.value, leaseId, input.leaseOwner, now);
    } finally {
        await releaseReactionRoleUserLease(context.db, {
            guildId: claim.value.guildId,
            leaseId,
            userId: claim.value.userId,
        });
    }
}

async function reconcileClaimedMemberState(
    context: BotFeatureHandlerContext,
    state: ReactionRoleMemberStateRecord,
    leaseId: string,
    leaseOwner: string,
    now: Date
): Promise<ReactionRoleMemberReconcileResult> {
    const loaded = await loadReactionRoleMemberReconciliation(context.db, { stateId: state.id });
    if (loaded.isErr() || !loaded.value) {
        return deferState(context, state, leaseId, now, 'database_error');
    }
    const { assignments, message, options } = loaded.value;
    if (loaded.value.state.revision !== state.revision) {
        return deferState(context, state, leaseId, now, 'revision_changed', 0);
    }

    if (!(await renewUserLease(context, state, leaseId, leaseOwner))) {
        return deferState(context, state, leaseId, now, 'user_lease_lost');
    }
    const platform = createFluxerPlatform(context.client);
    const memberResult = await platform.members.read({ guildId: state.guildId, userId: state.userId });
    if (memberResult.isErr()) {
        if (memberResult.error.type === 'not-found') {
            return finishState(context, state, leaseId, now, []);
        }
        return handlePlatformFailure(context, state, leaseId, now, memberResult.error, 'member_read_failed');
    }

    const desiredKeys = new Set(state.desiredEmojiKeys);
    const optionsByEmoji = new Map(options.map((option) => [option.emojiKey, option]));
    const roleIds = new Set(memberResult.value.roleIds);
    const removals = assignments.filter((assignment) => {
        const option = optionsByEmoji.get(assignment.emojiKey);
        return !desiredKeys.has(assignment.emojiKey) || option?.roleId !== assignment.roleId;
    });
    const additions = assignments.filter(
        (assignment) =>
            desiredKeys.has(assignment.emojiKey) &&
            optionsByEmoji.get(assignment.emojiKey)?.roleId === assignment.roleId
    );
    const removalAssignmentIds = new Set<string>();
    for (const assignment of removals) {
        if (!roleIds.has(assignment.roleId)) continue;
        const otherOwner = await hasOtherActiveReactionRoleAssignment(context.db, {
            assignmentId: assignment.id,
            guildId: state.guildId,
            roleId: assignment.roleId,
            userId: state.userId,
        });
        if (otherOwner.isErr()) return deferState(context, state, leaseId, now, 'database_error');
        if (!otherOwner.value) removalAssignmentIds.add(assignment.id);
    }
    const roleIdsToChange = [
        ...removals
            .filter((assignment) => removalAssignmentIds.has(assignment.id))
            .map((assignment) => assignment.roleId),
        ...additions.filter((assignment) => !roleIds.has(assignment.roleId)).map((assignment) => assignment.roleId),
    ];
    const manageable = await filterBotManageableRoleIds(context, {
        guildId: state.guildId,
        roleIds: [...new Set(roleIdsToChange)],
    });
    if (manageable.isErr()) return deferState(context, state, leaseId, now, 'role_preflight_failed');
    if (manageable.value.length !== new Set(roleIdsToChange).size) {
        return blockState(context, state, leaseId, now, 'role_hierarchy_blocked');
    }

    for (const assignment of removals) {
        if (removalAssignmentIds.has(assignment.id)) {
            if (!(await renewUserLease(context, state, leaseId, leaseOwner))) {
                return deferState(context, state, leaseId, now, 'user_lease_lost');
            }
            const removed = await platform.members.removeRole({
                guildId: state.guildId,
                roleId: assignment.roleId,
                userId: state.userId,
            });
            if (removed.isErr() && removed.error.type !== 'not-found') {
                return handlePlatformFailure(context, state, leaseId, now, removed.error, 'role_remove_failed');
            }
            roleIds.delete(assignment.roleId);
        }
        if (!(await renewUserLease(context, state, leaseId, leaseOwner))) {
            return deferState(context, state, leaseId, now, 'user_lease_lost');
        }
        const reaction = await platform.messages.removeReaction({
            channelId: message.channelId,
            emoji: assignment.emojiKey,
            messageId: message.messageId,
            userId: state.userId,
        });
        if (reaction.isErr() && reaction.error.type !== 'not-found') {
            return handlePlatformFailure(context, state, leaseId, now, reaction.error, 'reaction_remove_failed');
        }
    }

    const appliedEmojiKeys: string[] = [];
    for (const assignment of additions) {
        if (!roleIds.has(assignment.roleId)) {
            if (!(await renewUserLease(context, state, leaseId, leaseOwner))) {
                return deferState(context, state, leaseId, now, 'user_lease_lost');
            }
            const added = await platform.members.addRole({
                guildId: state.guildId,
                roleId: assignment.roleId,
                userId: state.userId,
            });
            if (added.isErr()) {
                return handlePlatformFailure(context, state, leaseId, now, added.error, 'role_add_failed');
            }
            roleIds.add(assignment.roleId);
        }
        appliedEmojiKeys.push(assignment.emojiKey);
    }

    if (!(await renewUserLease(context, state, leaseId, leaseOwner))) {
        return deferState(context, state, leaseId, now, 'user_lease_lost');
    }
    return finishState(context, state, leaseId, now, appliedEmojiKeys);
}

async function renewUserLease(
    context: BotFeatureHandlerContext,
    state: ReactionRoleMemberStateRecord,
    leaseId: string,
    leaseOwner: string
) {
    const leaseNow = new Date();
    const renewed = await renewReactionRoleUserLease(context.db, {
        guildId: state.guildId,
        leaseExpiresAt: new Date(leaseNow.getTime() + userLeaseTtlMs),
        leaseId,
        leaseOwner,
        now: leaseNow,
        userId: state.userId,
    });
    return renewed.isOk() && renewed.value;
}

async function finishState(
    context: BotFeatureHandlerContext,
    state: ReactionRoleMemberStateRecord,
    leaseId: string,
    now: Date,
    appliedEmojiKeys: string[]
): Promise<ReactionRoleMemberReconcileResult> {
    const result = await completeReactionRoleMemberState(context.db, {
        appliedEmojiKeys,
        leaseId,
        now,
        revision: state.revision,
        stateId: state.id,
    });
    return result.isOk() && result.value
        ? { status: 'synced', stateId: state.id }
        : deferState(context, state, leaseId, now, 'revision_changed', 0);
}

async function handlePlatformFailure(
    context: BotFeatureHandlerContext,
    state: ReactionRoleMemberStateRecord,
    leaseId: string,
    now: Date,
    error: FluxerPlatformError,
    fallbackCode: string
) {
    return error.type === 'permission-denied' || error.type === 'unsupported'
        ? blockState(context, state, leaseId, now, error.type)
        : deferState(context, state, leaseId, now, fallbackCode);
}

async function deferState(
    context: BotFeatureHandlerContext,
    state: ReactionRoleMemberStateRecord,
    leaseId: string,
    now: Date,
    errorCode: string,
    delayMs = retryDelayMs
): Promise<ReactionRoleMemberReconcileResult> {
    await deferReactionRoleMemberState(context.db, {
        errorCode,
        leaseId,
        nextAttemptAt: new Date(now.getTime() + delayMs),
        now,
        stateId: state.id,
    });
    return { status: 'deferred', stateId: state.id, errorCode };
}

async function blockState(
    context: BotFeatureHandlerContext,
    state: ReactionRoleMemberStateRecord,
    leaseId: string,
    now: Date,
    errorCode: string
): Promise<ReactionRoleMemberReconcileResult> {
    return deferState(context, state, leaseId, now, errorCode, blockedRetryDelayMs);
}
