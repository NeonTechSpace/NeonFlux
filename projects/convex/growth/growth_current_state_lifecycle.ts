import type { MutationCtx } from '../_generated/server.js';
import { maxCurrentInviteSnapshots } from './growth_overview_model.js';

export type GuildGrowthCurrentStateCleanupPlan<InviteId, StateId> = {
    growthStateId: StateId | null;
    inviteSnapshotIds: InviteId[];
};

export function planGuildGrowthCurrentStateCleanup<InviteId, StateId>(
    inviteSnapshotIds: readonly InviteId[],
    growthStateId: StateId | null
): GuildGrowthCurrentStateCleanupPlan<InviteId, StateId> {
    if (inviteSnapshotIds.length > maxCurrentInviteSnapshots) {
        throw new Error('invite-snapshot-limit-exceeded');
    }

    return {
        growthStateId,
        inviteSnapshotIds: [...inviteSnapshotIds],
    };
}

export async function clearGuildGrowthCurrentState(ctx: MutationCtx, guildId: string): Promise<void> {
    const [inviteSnapshots, growthState] = await Promise.all([
        ctx.db
            .query('guildInviteSnapshots')
            .withIndex('by_guild_code', (index) => index.eq('guildId', guildId))
            .take(maxCurrentInviteSnapshots + 1),
        ctx.db
            .query('guildGrowthStates')
            .withIndex('by_guild', (index) => index.eq('guildId', guildId))
            .unique(),
    ]);
    const plan = planGuildGrowthCurrentStateCleanup(
        inviteSnapshots.map((snapshot) => snapshot._id),
        growthState?._id ?? null
    );

    for (const id of plan.inviteSnapshotIds) {
        await ctx.db.delete('guildInviteSnapshots', id);
    }
    if (plan.growthStateId) {
        await ctx.db.delete('guildGrowthStates', plan.growthStateId);
    }
}
