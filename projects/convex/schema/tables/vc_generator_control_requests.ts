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

export const vcGeneratorControlRequestsTable = defineTable({
    completedAt: optionalTimestamp,
    controlAction: v.string(),
    createdAt: timestamp,
    errorMessage: optionalString,
    expiresAt: timestamp,
    generatedChannelLegacyId: v.string(),
    guildId: v.string(),
    legacyId: v.string(),
    panelChannelId: v.string(),
    promptMessageId: optionalString,
    requesterUserId: v.string(),
    status: v.string(),
    targetChannelId: v.string(),
    updatedAt: timestamp,
    value: optionalString,
})
    .index('by_generated_status', ['generatedChannelLegacyId', 'status'])
    .index('by_guild_panel_requester', ['guildId', 'panelChannelId', 'requesterUserId', 'status'])
    .index('by_status_expires', ['status', 'expiresAt'])
    .index('by_legacy', ['legacyId']);
