import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const generatedVoiceChannelsTable = defineTable({
    channelId: v.string(),
    createdAt: timestamp,
    guildId: v.string(),
    lastSeenAt: timestamp,
    legacyId: v.string(),
    ownerUserId: optionalString,
    ruleLegacyId: optionalString,
    status: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_rule_created', ['guildId', 'ruleLegacyId', 'createdAt'])
    .index('by_channel', ['channelId'])
    .index('by_guild_rule_status', ['guildId', 'ruleLegacyId', 'status'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_guild_owner_status_created', ['guildId', 'ownerUserId', 'status', 'createdAt'])
    .index('by_legacy', ['legacyId']);
