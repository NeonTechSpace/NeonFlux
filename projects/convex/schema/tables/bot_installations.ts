import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const botInstallationsTable = defineTable({
    guildId: v.string(),
    installedAt: timestamp,
    updatedAt: timestamp,
}).index('by_guild_id', ['guildId']);
