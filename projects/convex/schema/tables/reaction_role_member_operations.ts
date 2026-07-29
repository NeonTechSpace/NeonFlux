import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';
import {
    reactionRoleMemberOperationStatusValidator,
    reactionRoleSelectionSnapshotValidator,
} from '../../reaction_roles/reaction_role_validators.js';

export const reactionRoleMemberOperationsTable = defineTable({
    addedOptionIds: v.array(v.string()),
    attemptCount: v.number(),
    baselineRoleIds: v.optional(v.array(v.string())),
    createdAt: timestamp,
    desiredSelections: v.array(reactionRoleSelectionSnapshotValidator),
    errorCode: optionalString,
    guildId: v.string(),
    leaseExpiresAt: optionalTimestamp,
    leaseId: optionalString,
    leaseOwner: optionalString,
    nextAttemptAt: optionalTimestamp,
    panelGeneration: v.number(),
    panelId: v.id('reactionRolePanels'),
    previousSelections: v.array(reactionRoleSelectionSnapshotValidator),
    rerunRequested: v.boolean(),
    revision: v.number(),
    status: reactionRoleMemberOperationStatusValidator,
    updatedAt: timestamp,
    userId: v.string(),
})
    .index('by_panel_user', ['panelId', 'userId'])
    .index('by_status_lease_expiry', ['status', 'leaseExpiresAt'])
    .index('by_status_next_attempt', ['status', 'nextAttemptAt'])
    .index('by_status_updated', ['status', 'updatedAt'])
    .index('by_guild_updated', ['guildId', 'updatedAt'])
    .index('by_guild_user', ['guildId', 'userId']);
