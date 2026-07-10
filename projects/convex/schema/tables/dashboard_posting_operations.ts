import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const dashboardPostingOperationsTable = defineTable({
    actorUserId: v.string(),
    createdAt: timestamp,
    expiresAt: timestamp,
    guildId: v.string(),
    messageId: v.optional(v.string()),
    payloadHash: v.string(),
    requestKey: v.string(),
    requestedChannelId: v.string(),
    sentChannelId: v.optional(v.string()),
    status: v.union(v.literal('unknown'), v.literal('sent')),
    updatedAt: timestamp,
    completedAt: optionalTimestamp,
})
    .index('by_guild_request', ['guildId', 'requestKey'])
    .index('by_expires', ['expiresAt']);
