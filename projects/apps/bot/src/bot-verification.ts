import {
    findActiveVerificationRecord,
    findEnabledVerificationFlowByReaction,
    listVerificationFlowsByGuildId,
    upsertVerificationRecord,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { filterBotManageableRoleIds } from './bot-role-safety.js';

export type BotVerificationReactionEvent = {
    type: 'reaction.added';
    guildId: string | null;
    messageId: string;
    userId: string;
    emojiKey: string;
};

export type BotVerificationMemberJoinEvent = {
    type: 'member.joined';
    guildId: string;
    userId: string;
    roleIds: readonly string[];
};

export type BotVerificationResult =
    | {
          status: 'applied';
          action: 'event.verification.verified' | 'event.verification.member_joined';
          appliedRoleIds: string[];
      }
    | { status: 'ignored'; reason: 'bot-user-unavailable' | 'no-feature-handler' };

export async function applyVerificationReaction(
    context: BotFeatureHandlerContext,
    event: BotVerificationReactionEvent
): Promise<Result<BotVerificationResult, 'database-error' | 'platform-error'>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const flowResult = await findEnabledVerificationFlowByReaction(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
        emojiKey: event.emojiKey,
    });

    if (flowResult.isErr()) {
        return flowResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    const appliedRoleIdsResult = await applyVerificationRoles(context, {
        guildId: event.guildId,
        userId: event.userId,
        roleIds: [flowResult.value.verifiedRoleId],
        existingRoleIds: [],
    });

    if (appliedRoleIdsResult.isErr()) {
        if (appliedRoleIdsResult.error === 'bot-user-unavailable') {
            return ok({ status: 'ignored', reason: 'bot-user-unavailable' });
        }

        return err('platform-error');
    }

    if (appliedRoleIdsResult.value.length === 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const recordResult = await upsertVerificationRecord(context.db, {
        guildId: event.guildId,
        userId: event.userId,
        method: 'reaction',
    });

    if (recordResult.isErr()) {
        return err('database-error');
    }

    return ok({
        status: 'applied',
        action: 'event.verification.verified',
        appliedRoleIds: appliedRoleIdsResult.value,
    });
}

export async function restoreVerificationOnMemberJoin(
    context: BotFeatureHandlerContext,
    event: BotVerificationMemberJoinEvent
): Promise<Result<BotVerificationResult, 'database-error' | 'platform-error'>> {
    const recordResult = await findActiveVerificationRecord(context.db, {
        guildId: event.guildId,
        userId: event.userId,
    });

    if (recordResult.isErr()) {
        return recordResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    const flowsResult = await listVerificationFlowsByGuildId(context.db, {
        guildId: event.guildId,
        enabled: true,
    });

    if (flowsResult.isErr()) {
        return err('database-error');
    }

    const roleIds = [...new Set(flowsResult.value.map((flow) => flow.verifiedRoleId))];

    if (roleIds.length === 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const appliedRoleIdsResult = await applyVerificationRoles(context, {
        guildId: event.guildId,
        userId: event.userId,
        roleIds,
        existingRoleIds: event.roleIds,
    });

    if (appliedRoleIdsResult.isErr()) {
        if (appliedRoleIdsResult.error === 'bot-user-unavailable') {
            return ok({ status: 'ignored', reason: 'bot-user-unavailable' });
        }

        return err('platform-error');
    }

    if (appliedRoleIdsResult.value.length === 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    return ok({
        status: 'applied',
        action: 'event.verification.member_joined',
        appliedRoleIds: appliedRoleIdsResult.value,
    });
}

async function applyVerificationRoles(
    context: BotFeatureHandlerContext,
    input: {
        guildId: string;
        userId: string;
        roleIds: readonly string[];
        existingRoleIds: readonly string[];
    }
): Promise<Result<string[], 'bot-user-unavailable' | 'platform-error'>> {
    const candidateRoleIds = input.roleIds.filter((roleId) => !input.existingRoleIds.includes(roleId));

    if (candidateRoleIds.length === 0) {
        return ok([]);
    }

    const safeRoleIdsResult = await filterBotManageableRoleIds(context, {
        guildId: input.guildId,
        roleIds: candidateRoleIds,
    });

    if (safeRoleIdsResult.isErr()) {
        return err(safeRoleIdsResult.error);
    }

    if (safeRoleIdsResult.value.length === 0) {
        return ok([]);
    }

    const platform = createFluxerPlatform(context.client);
    const appliedRoleIds: string[] = [];

    for (const roleId of safeRoleIdsResult.value) {
        const addRoleResult = await platform.members.addRole({
            guildId: input.guildId,
            userId: input.userId,
            roleId,
        });

        if (addRoleResult.isErr()) {
            return err('platform-error');
        }

        appliedRoleIds.push(roleId);
    }

    return ok(appliedRoleIds);
}
