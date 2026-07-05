import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const guildSecurityPoliciesTable = defineTable({
    createdAt: timestamp,
    defconLevel: v.union(v.literal(1), v.literal(2), v.literal(3)),
    guildId: v.string(),
    updatedAt: timestamp,
}).index('by_guild_id', ['guildId']);
