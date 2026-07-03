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

export const suggestionsTable = defineTable({
    authorUserId: v.string(),
    boardLegacyId: optionalString,
    channelId: optionalString,
    closedAt: optionalTimestamp,
    content: v.string(),
    createdAt: timestamp,
    guildId: v.string(),
    legacyId: v.string(),
    messageId: optionalString,
    status: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_author', ['guildId', 'authorUserId'])
    .index('by_board_created', ['boardLegacyId', 'createdAt'])
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_legacy', ['legacyId']);
