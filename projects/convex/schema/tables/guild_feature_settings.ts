import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const guildFeatureSettingsTable = defineTable({
    config: jsonValue,
    createdAt: timestamp,
    enabled: v.boolean(),
    feature: v.string(),
    guildId: v.string(),
    legacyId: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild', ['guildId'])
    .index('by_guild_feature', ['guildId', 'feature']);
