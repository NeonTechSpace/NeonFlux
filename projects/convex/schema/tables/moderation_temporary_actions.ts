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

export const moderationTemporaryActionsTable = defineTable({
    action: v.string(),
    caseLegacyId: optionalString,
    createdAt: timestamp,
    expiresAt: timestamp,
    guildId: v.string(),
    legacyId: v.string(),
    status: v.union(v.literal('pending'), v.literal('completed'), v.literal('failed'), v.literal('cancelled')),
    targetUserId: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_guild_action_target_status_expires', ['guildId', 'action', 'targetUserId', 'status', 'expiresAt'])
    .index('by_status_action_expires', ['status', 'action', 'expiresAt'])
    .index('by_status_expires', ['status', 'expiresAt'])
    .index('by_legacy', ['legacyId']);
