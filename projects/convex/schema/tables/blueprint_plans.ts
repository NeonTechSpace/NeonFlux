import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const blueprintPlanSummaryValidator = v.object({
    creates: v.number(),
    updates: v.number(),
    deletes: v.number(),
    roles: v.number(),
    categories: v.number(),
    channels: v.number(),
});

export const blueprintPlanDecisionSummaryValidator = v.object({
    noOp: v.number(),
    create: v.number(),
    update: v.number(),
    delete: v.number(),
    protectedRetained: v.number(),
    protectedOmitted: v.number(),
    unmanagedRetained: v.number(),
    blockedAmbiguous: v.number(),
    blockedUnsupported: v.number(),
});

export const blueprintPlansTable = defineTable({
    authorityDigest: v.string(),
    authorityArtifactBytes: v.number(),
    authorityVersion: v.literal(1),
    blockerCount: v.number(),
    creationRequestKey: v.string(),
    createdAt: timestamp,
    createdByUserId: optionalString,
    decisionCount: v.number(),
    decisionLedgerBytes: v.number(),
    decisionLedgerDigest: v.string(),
    decisionSummary: blueprintPlanDecisionSummaryValidator,
    guildId: v.string(),
    deleteStepCount: v.number(),
    deleteSetDigest: optionalString,
    executionAuthorityDigest: v.string(),
    executionAuthorityBytes: v.number(),
    executionAuthorityVersion: v.literal(1),
    planDigest: v.string(),
    planVersion: v.literal(4),
    policy: v.union(v.literal('merge'), v.literal('synchronize'), v.literal('rebuild')),
    projectedSnapshotDigest: v.string(),
    requestedSnapshotDigest: v.string(),
    sealedAt: v.optional(timestamp),
    sourceBackupId: v.optional(v.id('structureBackups')),
    status: v.union(
        v.literal('draft'),
        v.literal('needs_input'),
        v.literal('review_ready'),
        v.literal('approved'),
        v.literal('obsolete')
    ),
    stepCount: v.number(),
    stepLedgerBytes: v.number(),
    stepLedgerDigest: v.string(),
    summary: blueprintPlanSummaryValidator,
    updatedAt: timestamp,
})
    .index('by_updated', ['updatedAt'])
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_sealed', ['guildId', 'sealedAt'])
    .index('by_guild_creation_request', ['guildId', 'creationRequestKey'])
    .index('by_guild_status', ['guildId', 'status']);
