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

export const guildDefconExemptionsTable = defineTable({
    category: v.string(),
    createdAt: timestamp,
    guildId: v.string(),
    legacyId: v.string(),
})
    .index('by_guild', ['guildId'])
    .index('by_guild_category', ['guildId', 'category']);
