import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';
import {
    reactionRolePanelOperationStatusValidator,
    reactionRolePanelOperationStepValidator,
    reactionRolePanelOperationTypeValidator,
} from '../../reaction_roles/reaction_role_validators.js';

export const reactionRolePanelOperationsTable = defineTable({
    actorUserId: v.string(),
    attemptCount: v.number(),
    createdAt: timestamp,
    deleteMessage: v.optional(v.boolean()),
    errorCode: optionalString,
    generation: v.optional(v.number()),
    guildId: v.string(),
    leaseExpiresAt: optionalTimestamp,
    leaseId: optionalString,
    leaseOwner: optionalString,
    messageId: optionalString,
    nonce: v.string(),
    nextAttemptAt: optionalTimestamp,
    panelId: v.id('reactionRolePanels'),
    requestFingerprint: v.string(),
    requestKey: v.string(),
    revokeOwnedRoles: v.optional(v.boolean()),
    status: reactionRolePanelOperationStatusValidator,
    step: reactionRolePanelOperationStepValidator,
    targetVersionId: v.id('reactionRolePanelVersions'),
    type: reactionRolePanelOperationTypeValidator,
    updatedAt: timestamp,
})
    .index('by_guild_updated', ['guildId', 'updatedAt'])
    .index('by_guild_request', ['guildId', 'requestKey'])
    .index('by_panel_updated', ['panelId', 'updatedAt'])
    .index('by_status_lease_expiry', ['status', 'leaseExpiresAt'])
    .index('by_status_next_attempt', ['status', 'nextAttemptAt'])
    .index('by_status_updated', ['status', 'updatedAt']);
