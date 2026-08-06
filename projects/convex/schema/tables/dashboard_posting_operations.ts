import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';
import {
    dashboardPostingOperationResolutionValidator,
    outgoingEmbedValidator,
} from '../../posting/message_validators.js';

export const dashboardPostingOperationsTable = defineTable({
    actorDisplayName: optionalString,
    actorUsername: optionalString,
    actorUserId: v.string(),
    allowMassMentions: v.optional(v.boolean()),
    attemptCount: v.optional(v.number()),
    content: v.optional(v.string()),
    contentLength: v.optional(v.number()),
    createdAt: timestamp,
    embeds: v.optional(v.array(outgoingEmbedValidator)),
    embedCount: v.optional(v.number()),
    errorCode: optionalString,
    expiresAt: optionalTimestamp,
    externalChannelId: optionalString,
    externalMessageId: optionalString,
    followupOperationId: optionalString,
    guildId: v.string(),
    leaseExpiresAt: optionalTimestamp,
    leaseId: optionalString,
    leaseOwner: optionalString,
    messageId: v.optional(v.string()),
    nextAttemptAt: optionalTimestamp,
    payloadHash: v.string(),
    requestKey: v.string(),
    requestedChannelId: v.string(),
    resolution: v.optional(dashboardPostingOperationResolutionValidator),
    resolvedAt: optionalTimestamp,
    resolvedByUserId: optionalString,
    retryOfOperationId: optionalString,
    sendStartedAt: optionalTimestamp,
    sentChannelId: v.optional(v.string()),
    status: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('unknown'),
        v.literal('sent'),
        v.literal('permanent_failure')
    ),
    updatedAt: timestamp,
    completedAt: optionalTimestamp,
})
    .index('by_guild_updated', ['guildId', 'updatedAt'])
    .index('by_guild_request', ['guildId', 'requestKey'])
    .index('by_status_expires', ['status', 'expiresAt'])
    .index('by_status_lease_expiry', ['status', 'leaseExpiresAt'])
    .index('by_status_next_attempt', ['status', 'nextAttemptAt']);
