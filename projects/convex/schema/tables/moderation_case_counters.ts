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

export const moderationCaseCountersTable = defineTable({
    guildId: v.string(),
    nextCaseNumber: v.number(),
    updatedAt: timestamp,
}).index('by_guild_id', ['guildId']);
