import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const reactionRoleUserLeasesTable = defineTable({
    guildId: v.string(),
    leaseExpiresAt: timestamp,
    leaseId: v.string(),
    leaseOwner: v.string(),
    updatedAt: timestamp,
    userId: v.string(),
})
    .index('by_expiry', ['leaseExpiresAt'])
    .index('by_guild_user', ['guildId', 'userId']);
