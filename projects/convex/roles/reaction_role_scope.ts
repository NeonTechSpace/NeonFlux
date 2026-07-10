import { v } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { query, type MutationCtx, type QueryCtx } from '../_generated/server.js';

const botService = ['bot'] as const;

export const isReactionRoleGuildRunnable = query({
    args: { guildId: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        return isGuildRunnable(ctx, args.guildId);
    },
});

export async function isGuildRunnable(ctx: QueryCtx | MutationCtx, guildIdValue: string): Promise<boolean> {
    const guildId = guildIdValue.trim();
    const [config, installation] = await Promise.all([
        ctx.db.query('deploymentConfig').withIndex('by_config_id').unique(),
        ctx.db
            .query('botInstallations')
            .withIndex('by_guild_id', (candidate) => candidate.eq('guildId', guildId))
            .unique(),
    ]);
    if (!config || !installation) return false;
    return config.instanceMode !== 'single' || config.singleGuildId === guildId;
}
