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

export const botInstallationsTable = defineTable({
    guildId: v.string(),
    installedAt: timestamp,
    updatedAt: timestamp,
}).index('by_guild_id', ['guildId']);
