import { v } from 'convex/values';

import { mutation, query } from '../_generated/server.js';
import {
    backupRecordValidator,
    backupRetentionPruneResultValidator,
    backupSettingsValidator,
    backupSettingsPageValidator,
    backupSummaryPageValidator,
    backupSummaryRecordValidator,
    createBackupArgs,
    deleteBackupArgs,
    dueSettingsArgs,
    findBackupArgs,
    guildIdArgs,
    leaseClaimArgs,
    leaseClearArgs,
    listBackupSummaryPageArgs,
    observedStateValidator,
    pruneBackupsArgs,
    recordObservedEventArgs,
    recordScheduledDriftResultArgs,
    renameBackupArgs,
    upsertBackupSettingsArgs,
} from './blueprint_backup_contract.js';
import {
    createStructureBackupHandler,
    deleteStructureBackupHandler,
    renameStructureBackupHandler,
} from './blueprint_backup_manual.js';
import {
    findLatestStructureDriftBaselineBackupByGuildIdHandler,
    findStructureBackupByGuildIdHandler,
    findStructureObservedEventStateByGuildIdHandler,
    listStructureBackupSummaryPageByGuildIdHandler,
    recordStructureObservedEventHandler,
} from './blueprint_backup_reads.js';
import {
    claimDueStructureBackupSettingHandler,
    claimDueStructureDriftSettingHandler,
    clearStructureBackupSettingLeaseHandler,
    clearStructureDriftSettingLeaseHandler,
    findStructureBackupSettingsByGuildIdHandler,
    listDueStructureBackupRetentionSettingsHandler,
    listDueStructureBackupSettingsHandler,
    listDueStructureDriftSettingsHandler,
    pruneExpiredStructureBackupsForGuildHandler,
    recordStructureScheduledDriftResultHandler,
    upsertStructureBackupSettingsHandler,
} from './blueprint_backup_scheduled.js';

export { auditInputValidator, recordBlueprintAuditInMutation } from './blueprint_audit.js';

export const findStructureObservedEventStateByGuildId = query({
    args: guildIdArgs,
    returns: observedStateValidator,
    handler: findStructureObservedEventStateByGuildIdHandler,
});

export const recordStructureObservedEvent = mutation({
    args: recordObservedEventArgs,
    returns: observedStateValidator,
    handler: recordStructureObservedEventHandler,
});

export const createStructureBackup = mutation({
    args: createBackupArgs,
    returns: backupRecordValidator,
    handler: createStructureBackupHandler,
});

export const listStructureBackupSummaryPageByGuildId = query({
    args: listBackupSummaryPageArgs,
    returns: backupSummaryPageValidator,
    handler: listStructureBackupSummaryPageByGuildIdHandler,
});

export const renameStructureBackup = mutation({
    args: renameBackupArgs,
    returns: v.union(backupSummaryRecordValidator, v.null()),
    handler: renameStructureBackupHandler,
});

export const deleteStructureBackup = mutation({
    args: deleteBackupArgs,
    returns: v.boolean(),
    handler: deleteStructureBackupHandler,
});

export const findStructureBackupByGuildId = query({
    args: findBackupArgs,
    returns: v.union(backupRecordValidator, v.null()),
    handler: findStructureBackupByGuildIdHandler,
});

export const findLatestStructureDriftBaselineBackupByGuildId = query({
    args: guildIdArgs,
    returns: v.union(backupRecordValidator, v.null()),
    handler: findLatestStructureDriftBaselineBackupByGuildIdHandler,
});

export const findStructureBackupSettingsByGuildId = query({
    args: guildIdArgs,
    returns: backupSettingsValidator,
    handler: findStructureBackupSettingsByGuildIdHandler,
});

export const upsertStructureBackupSettings = mutation({
    args: upsertBackupSettingsArgs,
    returns: backupSettingsValidator,
    handler: upsertStructureBackupSettingsHandler,
});

export const listDueStructureBackupSettings = query({
    args: dueSettingsArgs,
    returns: backupSettingsPageValidator,
    handler: listDueStructureBackupSettingsHandler,
});

export const listDueStructureDriftSettings = query({
    args: dueSettingsArgs,
    returns: backupSettingsPageValidator,
    handler: listDueStructureDriftSettingsHandler,
});

export const listDueStructureBackupRetentionSettings = query({
    args: dueSettingsArgs,
    returns: backupSettingsPageValidator,
    handler: listDueStructureBackupRetentionSettingsHandler,
});

export const pruneExpiredStructureBackupsForGuild = mutation({
    args: pruneBackupsArgs,
    returns: backupRetentionPruneResultValidator,
    handler: pruneExpiredStructureBackupsForGuildHandler,
});

export const claimDueStructureBackupSetting = mutation({
    args: leaseClaimArgs,
    returns: v.union(backupSettingsValidator, v.null()),
    handler: claimDueStructureBackupSettingHandler,
});

export const clearStructureBackupSettingLease = mutation({
    args: leaseClearArgs,
    returns: v.boolean(),
    handler: clearStructureBackupSettingLeaseHandler,
});

export const claimDueStructureDriftSetting = mutation({
    args: leaseClaimArgs,
    returns: v.union(backupSettingsValidator, v.null()),
    handler: claimDueStructureDriftSettingHandler,
});

export const clearStructureDriftSettingLease = mutation({
    args: leaseClearArgs,
    returns: v.boolean(),
    handler: clearStructureDriftSettingLeaseHandler,
});

export const recordStructureScheduledDriftResult = mutation({
    args: recordScheduledDriftResultArgs,
    returns: backupSettingsValidator,
    handler: recordStructureScheduledDriftResultHandler,
});
