import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
    encryptedOAuthTokenPayload,
    jsonValue,
    optionalNumber,
    optionalString,
    optionalTimestamp,
    timestamp,
} from '../shared.js';

export const moderationCasesTable = defineTable({
    action: v.string(),
    actorUserId: optionalString,
    caseNumber: v.number(),
    createdAt: timestamp,
    guildId: v.string(),
    legacyId: v.string(),
    reason: optionalString,
    status: v.string(),
    targetChannelId: optionalString,
    targetType: v.union(v.literal('channel'), v.literal('user')),
    targetUserId: optionalString,
    updatedAt: timestamp,
})
    .index('by_guild_case_number', ['guildId', 'caseNumber'])
    .index('by_guild_channel', ['guildId', 'targetChannelId'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_guild_target', ['guildId', 'targetUserId'])
    .index('by_guild_target_action_created', ['guildId', 'targetUserId', 'action', 'createdAt'])
    .index('by_legacy', ['legacyId']);
