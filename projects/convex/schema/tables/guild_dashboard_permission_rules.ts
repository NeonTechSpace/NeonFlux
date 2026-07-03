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

export const guildDashboardPermissionRulesTable = defineTable({
    createdAt: timestamp,
    guildId: v.string(),
    roleIds: v.array(v.string()),
    updatedAt: timestamp,
    userIds: v.array(v.string()),
}).index('by_guild_id', ['guildId']);
