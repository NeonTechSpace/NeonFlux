import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const guildUserXpTable = defineTable({
    guildId: v.string(),
    lastMessageXpAt: optionalTimestamp,
    lastVoiceXpAt: optionalTimestamp,
    level: v.number(),
    messageCount: v.number(),
    messageXp: v.number(),
    updatedAt: timestamp,
    userId: v.string(),
    voiceSeconds: v.number(),
    voiceXp: v.number(),
    xp: v.number(),
})
    .index('by_guild_level', ['guildId', 'level'])
    .index('by_guild_user', ['guildId', 'userId'])
    .index('by_guild_xp_level_user', ['guildId', 'xp', 'level', 'userId']);
