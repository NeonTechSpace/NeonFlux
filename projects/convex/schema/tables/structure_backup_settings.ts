import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const structureBackupSettingsTable = defineTable({
    backupLeaseExpiresAt: optionalTimestamp,
    backupLeaseId: optionalString,
    backupLeaseOwner: optionalString,
    backupLeaseStartedAt: optionalTimestamp,
    cadenceWeeks: v.number(),
    createdAt: timestamp,
    driftLeaseExpiresAt: optionalTimestamp,
    driftLeaseId: optionalString,
    driftLeaseOwner: optionalString,
    driftLeaseStartedAt: optionalTimestamp,
    enabled: v.boolean(),
    guildId: v.string(),
    lastDriftBaselineBackupId: optionalString,
    lastDriftBaselineName: optionalString,
    lastDriftChangeCount: v.optional(v.number()),
    lastDriftCheckedAt: optionalTimestamp,
    lastDriftErrorMessage: optionalString,
    lastDriftFieldSummary: v.optional(v.any()),
    lastDriftHasMorePreview: v.optional(v.boolean()),
    lastDriftLiveCounts: v.optional(v.any()),
    lastDriftStatus: optionalString,
    lastDriftSummary: v.optional(v.any()),
    lastAttemptAt: optionalTimestamp,
    lastErrorMessage: optionalString,
    lastSuccessAt: optionalTimestamp,
    nextBackupAt: optionalTimestamp,
    nextDriftCheckAt: optionalTimestamp,
    nextRetentionPruneAt: optionalTimestamp,
    retentionCutoff: optionalTimestamp,
    retentionCursor: optionalString,
    retentionDays: v.number(),
    updatedAt: timestamp,
})
    .index('by_guild', ['guildId'])
    .index('by_enabled_next_backup', ['enabled', 'nextBackupAt'])
    .index('by_enabled_next_drift_check', ['enabled', 'nextDriftCheckAt'])
    .index('by_next_retention_prune', ['nextRetentionPruneAt']);
