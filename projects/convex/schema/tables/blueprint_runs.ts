import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const blueprintRunsTable = defineTable({
    appliedSteps: v.number(),
    authorizationDecision: v.optional(
        v.union(
            v.literal('authorized'),
            v.literal('structure_changed'),
            v.literal('capability_changed'),
            v.literal('structure_and_capability_changed'),
            v.literal('restore_observation_diverged'),
            v.literal('preflight_expired'),
            v.literal('fingerprint_version_mismatch')
        )
    ),
    authorizationMismatchJson: optionalString,
    completedMutationSteps: v.number(),
    completedAt: optionalTimestamp,
    controlRequest: v.optional(v.union(v.literal('pause'), v.literal('cancel'))),
    createdAt: timestamp,
    errorType: optionalString,
    currentStepDomain: optionalString,
    currentStepId: optionalString,
    currentStepLabel: optionalString,
    failedSteps: v.number(),
    fingerprintVersion: v.literal(2),
    guildId: v.string(),
    heartbeatAt: optionalTimestamp,
    idMap: jsonValue,
    leaseExpiresAt: optionalTimestamp,
    leaseId: optionalString,
    leaseOwner: optionalString,
    nextStepSequence: v.number(),
    notStartedSteps: v.number(),
    mutationAuthorizedAt: optionalTimestamp,
    mutationAuthorizationLeaseId: optionalString,
    expectedCapabilityFingerprint: v.string(),
    expectedStructureFingerprint: v.string(),
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
    protocolVersion: v.number(),
    retryAt: optionalTimestamp,
    restorePointBackupId: optionalString,
    planId: v.id('blueprintPlans'),
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
    skippedSteps: v.number(),
    totalSteps: v.number(),
    totalMutationSteps: v.number(),
    updatedAt: timestamp,
    verificationResult: v.optional(jsonValue),
    verificationStatus: v.optional(v.union(v.literal('matched'), v.literal('mismatch'), v.literal('read_failed'))),
})
    .index('by_status_retry', ['status', 'retryAt'])
    .index('by_status_protocol_retry', ['status', 'protocolVersion', 'retryAt'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_plan_status', ['planId', 'status'])
    .index('by_plan_created', ['planId', 'createdAt']);
