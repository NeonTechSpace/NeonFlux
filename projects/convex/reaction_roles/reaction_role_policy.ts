import { v } from 'convex/values';

import { query, type QueryCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';

const botService = ['bot'] as const;
const storedDefconLevelValidator = v.union(v.literal(1), v.literal(2), v.literal(3), v.null());

export const readReactionRoleExecutionPolicy = query({
    args: { guildId: v.string() },
    returns: v.object({
        botInstalled: v.boolean(),
        storedDefconLevel: storedDefconLevelValidator,
    }),
    handler: readReactionRoleExecutionPolicyHandler,
});

export async function readReactionRoleExecutionPolicyHandler(ctx: QueryCtx, args: { guildId: string }) {
    await requireNeonFluxService(ctx, botService);
    const guildId = args.guildId.trim();
    if (!guildId) throw new Error('missing-guild-id');

    const [installation, securityPolicy] = await Promise.all([
        ctx.db
            .query('botInstallations')
            .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
            .unique(),
        ctx.db
            .query('guildSecurityPolicies')
            .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
            .unique(),
    ]);

    return {
        botInstalled: installation !== null,
        storedDefconLevel: securityPolicy?.defconLevel ?? null,
    };
}
