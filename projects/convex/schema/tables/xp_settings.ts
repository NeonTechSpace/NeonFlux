import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const xpSettingsTable = defineTable({
    config: jsonValue,
    cooldownSeconds: v.number(),
    enabled: v.boolean(),
    guildId: v.string(),
    messageXpMax: v.number(),
    messageXpMin: v.number(),
    updatedAt: timestamp,
    voiceMinimumMinutes: v.number(),
    voiceXpPerMinute: v.number(),
}).index('by_guild_id', ['guildId']);
