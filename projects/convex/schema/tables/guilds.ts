import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const guildsTable = defineTable({
    firstSeenAt: timestamp,
    guildId: v.string(),
    updatedAt: timestamp,
}).index('by_guild_id', ['guildId']);
