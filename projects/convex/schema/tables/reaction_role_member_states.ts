import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const reactionRoleMemberStatesTable = defineTable({
    configRevision: v.number(),
    createdAt: timestamp,
    desiredEmojiKeys: v.array(v.string()),
    errorCode: optionalString,
    guildId: v.string(),
    leaseExpiresAt: optionalTimestamp,
    leaseId: optionalString,
    leaseOwner: optionalString,
    messageId: v.string(),
    nextAttemptAt: optionalTimestamp,
    reactionRoleMessageId: v.id('reactionRoleMessages'),
    revision: v.number(),
    status: v.string(),
    updatedAt: timestamp,
    userId: v.string(),
})
    .index('by_message_status', ['reactionRoleMessageId', 'status'])
    .index('by_message_status_lease_expiry', ['reactionRoleMessageId', 'status', 'leaseExpiresAt'])
    .index('by_message_user', ['reactionRoleMessageId', 'userId'])
    .index('by_status_lease_expiry', ['status', 'leaseExpiresAt'])
    .index('by_status_next_attempt', ['status', 'nextAttemptAt'])
    .index('by_status_updated', ['status', 'updatedAt']);
