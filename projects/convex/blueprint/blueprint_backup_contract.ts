import { v, type Infer } from 'convex/values';

import { auditInputValidator } from './blueprint_audit.js';

const nullableString = v.union(v.string(), v.null());
const backupSourceValidator = v.union(v.literal('manual'), v.literal('scheduled'), v.literal('restore_point'));
const backupStatusValidator = v.union(v.literal('succeeded'), v.literal('failed'));

export const backupRecordValidator = v.object({
    categoryCount: v.number(),
    channelCount: v.number(),
    completedAt: v.string(),
    createdAt: v.string(),
    createdByUserId: nullableString,
    errorMessage: nullableString,
    guildId: v.string(),
    id: v.string(),
    name: v.string(),
    roleCount: v.number(),
    source: backupSourceValidator,
    status: backupStatusValidator,
    structure: v.union(v.any(), v.null()),
});

export const backupSummaryRecordValidator = v.object({
    categoryCount: v.number(),
    channelCount: v.number(),
    completedAt: v.string(),
    createdAt: v.string(),
    createdByUserId: nullableString,
    errorMessage: nullableString,
    guildId: v.string(),
    id: v.string(),
    name: v.string(),
    roleCount: v.number(),
    source: backupSourceValidator,
    status: backupStatusValidator,
});

export const backupSettingsValidator = v.object({
    cadenceWeeks: v.number(),
    createdAt: v.optional(v.string()),
    enabled: v.boolean(),
    guildId: v.string(),
    lastDriftBaselineBackupId: nullableString,
    lastDriftBaselineName: nullableString,
    lastDriftChangeCount: v.union(v.number(), v.null()),
    lastDriftCheckedAt: nullableString,
    lastDriftErrorMessage: nullableString,
    lastDriftFieldSummary: v.union(v.any(), v.null()),
    lastDriftHasMorePreview: v.boolean(),
    lastDriftLiveCounts: v.union(v.any(), v.null()),
    lastDriftStatus: nullableString,
    lastDriftSummary: v.union(v.any(), v.null()),
    lastAttemptAt: nullableString,
    lastErrorMessage: nullableString,
    lastSuccessAt: nullableString,
    nextBackupAt: nullableString,
    nextDriftCheckAt: nullableString,
    nextRetentionPruneAt: nullableString,
    retentionDays: v.number(),
    updatedAt: v.optional(v.string()),
});

export const backupSummaryPageValidator = v.object({
    backups: v.array(backupSummaryRecordValidator),
    nextCursor: nullableString,
});

export const backupRetentionPruneResultValidator = v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
    nextRetentionPruneAt: nullableString,
});

export const observedStateValidator = v.object({
    createdAt: v.optional(v.string()),
    guildId: v.string(),
    lastEventType: v.optional(v.string()),
    lastObservedAt: v.optional(v.string()),
    lastTargetId: v.optional(v.string()),
    lastTargetType: v.optional(v.string()),
    observedChangeCount: v.number(),
    targetChangeCounts: v.record(v.string(), v.number()),
    updatedAt: v.optional(v.string()),
});

export const guildIdArgs = { guildId: v.string() };
export const recordObservedEventArgs = {
    eventType: v.string(),
    guildId: v.string(),
    targetId: v.optional(v.union(v.string(), v.null())),
    targetType: v.string(),
};
export const createBackupArgs = {
    categoryCount: v.optional(v.number()),
    audit: v.optional(auditInputValidator),
    channelCount: v.optional(v.number()),
    createdAt: v.optional(v.string()),
    createdByUserId: v.optional(v.union(v.string(), v.null())),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    guildId: v.string(),
    name: v.optional(v.union(v.string(), v.null())),
    roleCount: v.optional(v.number()),
    serverName: v.optional(v.union(v.string(), v.null())),
    source: v.optional(v.string()),
    status: v.optional(v.string()),
    structure: v.optional(v.any()),
};
export const listBackupsArgs = { guildId: v.string(), limit: v.optional(v.number()) };
export const listBackupSummaryPageArgs = {
    cursor: v.optional(v.union(v.string(), v.null())),
    guildId: v.string(),
    limit: v.optional(v.number()),
};
export const renameBackupArgs = {
    audit: v.optional(auditInputValidator),
    backupId: v.string(),
    guildId: v.string(),
    name: v.string(),
};
export const deleteBackupArgs = {
    audit: v.optional(auditInputValidator),
    backupId: v.string(),
    guildId: v.string(),
};
export const findBackupArgs = { backupId: v.string(), guildId: v.string() };
export const upsertBackupSettingsArgs = {
    audit: v.optional(auditInputValidator),
    cadenceWeeks: v.optional(v.number()),
    enabled: v.boolean(),
    guildId: v.string(),
    retentionDays: v.optional(v.number()),
};
export const dueSettingsArgs = { limit: v.optional(v.number()), now: v.string() };
export const pruneBackupsArgs = {
    audit: v.optional(auditInputValidator),
    guildId: v.string(),
    limit: v.optional(v.number()),
    now: v.string(),
};
export const leaseClaimArgs = {
    guildId: v.string(),
    leaseExpiresAt: v.string(),
    leaseId: v.string(),
    leaseOwner: v.string(),
    now: v.string(),
};
export const leaseClearArgs = {
    guildId: v.string(),
    leaseId: v.string(),
    now: v.string(),
};
export const recordScheduledDriftResultArgs = {
    audit: v.optional(auditInputValidator),
    baselineBackupId: v.optional(v.union(v.string(), v.null())),
    baselineName: v.optional(v.union(v.string(), v.null())),
    changeCount: v.optional(v.number()),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    fieldSummary: v.optional(v.any()),
    guildId: v.string(),
    hasMorePreview: v.optional(v.boolean()),
    liveCounts: v.optional(v.any()),
    now: v.string(),
    status: v.string(),
    summary: v.optional(v.any()),
};

export type GuildIdArgs = Infer<ReturnType<typeof v.object<typeof guildIdArgs>>>;
export type RecordObservedEventArgs = Infer<ReturnType<typeof v.object<typeof recordObservedEventArgs>>>;
export type CreateBackupArgs = Infer<ReturnType<typeof v.object<typeof createBackupArgs>>>;
export type ListBackupsArgs = Infer<ReturnType<typeof v.object<typeof listBackupsArgs>>>;
export type ListBackupSummaryPageArgs = Infer<ReturnType<typeof v.object<typeof listBackupSummaryPageArgs>>>;
export type RenameBackupArgs = Infer<ReturnType<typeof v.object<typeof renameBackupArgs>>>;
export type DeleteBackupArgs = Infer<ReturnType<typeof v.object<typeof deleteBackupArgs>>>;
export type FindBackupArgs = Infer<ReturnType<typeof v.object<typeof findBackupArgs>>>;
export type UpsertBackupSettingsArgs = Infer<ReturnType<typeof v.object<typeof upsertBackupSettingsArgs>>>;
export type DueSettingsArgs = Infer<ReturnType<typeof v.object<typeof dueSettingsArgs>>>;
export type PruneBackupsArgs = Infer<ReturnType<typeof v.object<typeof pruneBackupsArgs>>>;
export type LeaseClaimArgs = Infer<ReturnType<typeof v.object<typeof leaseClaimArgs>>>;
export type LeaseClearArgs = Infer<ReturnType<typeof v.object<typeof leaseClearArgs>>>;
export type RecordScheduledDriftResultArgs = Infer<ReturnType<typeof v.object<typeof recordScheduledDriftResultArgs>>>;
