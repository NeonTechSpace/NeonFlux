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
    enabled: v.boolean(),
    guildId: v.string(),
    lastAttemptAt: optionalTimestamp,
    lastErrorMessage: optionalString,
    lastSuccessAt: optionalTimestamp,
    nextBackupAt: optionalTimestamp,
    nextRetentionPruneAt: optionalTimestamp,
    retentionDays: v.number(),
    updatedAt: timestamp,
})
    .index('by_guild', ['guildId'])
    .index('by_enabled_next_backup', ['enabled', 'nextBackupAt'])
    .index('by_next_retention_prune', ['nextRetentionPruneAt']);
