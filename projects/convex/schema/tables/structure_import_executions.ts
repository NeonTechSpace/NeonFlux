import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const structureImportExecutionsTable = defineTable({
    appliedActions: v.number(),
    completedMutationSteps: v.number(),
    completedAt: optionalTimestamp,
    controlRequest: v.optional(v.union(v.literal('pause'), v.literal('cancel'))),
    createdAt: timestamp,
    errorType: optionalString,
    currentActionDomain: optionalString,
    currentActionId: optionalString,
    currentActionLabel: optionalString,
    failedActions: v.number(),
    guildId: v.string(),
    heartbeatAt: optionalTimestamp,
    idMap: jsonValue,
    leaseExpiresAt: optionalTimestamp,
    leaseId: optionalString,
    leaseOwner: optionalString,
    nextActionSequence: v.number(),
    notStartedActions: v.number(),
    mutationAuthorizedAt: optionalTimestamp,
    mutationAuthorizationLeaseId: optionalString,
    phase: v.union(
        v.literal('queued'),
        v.literal('preparing'),
        v.literal('create'),
        v.literal('update'),
        v.literal('delete'),
        v.literal('channel_order'),
        v.literal('role_order'),
        v.literal('waiting_rate_limit'),
        v.literal('paused'),
        v.literal('verifying'),
        v.literal('complete')
    ),
    preflightDigest: v.string(),
    preflightExpiresAt: timestamp,
    preflightLiveFingerprint: v.string(),
    protocolVersion: v.number(),
    retryAt: optionalTimestamp,
    restorePointBackupId: optionalString,
    runId: v.id('structureImportRuns'),
    startedAt: optionalTimestamp,
    status: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('waiting_rate_limit'),
        v.literal('pause_requested'),
        v.literal('paused'),
        v.literal('verifying'),
        v.literal('succeeded'),
        v.literal('partially_applied'),
        v.literal('failed_before_mutation'),
        v.literal('needs_reconciliation'),
        v.literal('outcome_unknown'),
        v.literal('cancelled')
    ),
    skippedActions: v.number(),
    totalActions: v.number(),
    totalMutationSteps: v.number(),
    updatedAt: timestamp,
    verificationResult: v.optional(jsonValue),
    verificationStatus: v.optional(v.union(v.literal('matched'), v.literal('mismatch'), v.literal('read_failed'))),
})
    .index('by_status_retry', ['status', 'retryAt'])
    .index('by_status_protocol_retry', ['status', 'protocolVersion', 'retryAt'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_run_created', ['runId', 'createdAt']);
