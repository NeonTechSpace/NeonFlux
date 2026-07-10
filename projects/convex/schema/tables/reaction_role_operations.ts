import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';

const desiredOption = v.object({
    emojiKey: v.string(),
    position: v.number(),
    roleId: v.string(),
});

export const reactionRoleOperationsTable = defineTable({
    actorMetadata: v.optional(v.any()),
    actorUserId: v.string(),
    attemptCount: v.number(),
    blockedCount: v.number(),
    channelId: v.string(),
    completedAt: optionalTimestamp,
    createdAt: timestamp,
    desiredConfig: v.object({
        enabled: v.boolean(),
        generateOverview: v.boolean(),
        messageContent: v.optional(v.string()),
        messageEmbeds: v.array(v.any()),
        mode: v.string(),
        options: v.array(desiredOption),
    }),
    errorCode: optionalString,
    expectedRevision: v.optional(v.number()),
    externalMessageId: optionalString,
    failureCount: v.optional(v.number()),
    guildId: v.string(),
    idempotencyKey: v.string(),
    leaseExpiresAt: optionalTimestamp,
    leaseId: optionalString,
    leaseOwner: optionalString,
    nextAttemptAt: optionalTimestamp,
    processedCount: v.number(),
    reactionRoleMessageId: v.optional(v.id('reactionRoleMessages')),
    requestHash: v.string(),
    sendStartedAt: optionalTimestamp,
    snapshotComplete: v.boolean(),
    snapshotCursor: optionalString,
    stage: v.string(),
    status: v.string(),
    succeededCount: v.number(),
    totalCount: v.number(),
    type: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_idempotency', ['guildId', 'idempotencyKey'])
    .index('by_guild_status_updated', ['guildId', 'status', 'updatedAt'])
    .index('by_message_created', ['reactionRoleMessageId', 'createdAt'])
    .index('by_status_completed', ['status', 'completedAt'])
    .index('by_status_lease_expiry', ['status', 'leaseExpiresAt'])
    .index('by_status_next_attempt', ['status', 'nextAttemptAt'])
    .index('by_status_updated', ['status', 'updatedAt']);
