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

export const messageTemplatesTable = defineTable({
    content: optionalString,
    createdAt: timestamp,
    createdByUserId: optionalString,
    embeds: v.array(v.any()),
    guildId: v.string(),
    legacyId: v.string(),
    name: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_legacy', ['guildId', 'legacyId'])
    .index('by_guild_name', ['guildId', 'name'])
    .index('by_guild_updated', ['guildId', 'updatedAt'])
    .index('by_legacy', ['legacyId']);
