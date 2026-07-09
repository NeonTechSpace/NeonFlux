import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { dashboardLiveAreasForBotActionFeature } from '../core/dashboard_live_model.js';
import { buildBotActionEventDocument } from '../core/events_model.js';
import {
    addDays,
    buildBackupSortCursor,
    buildObservedEventStateDocument,
    buildStructureBackupAttemptPatch,
    buildStructureBackupDocument,
    buildStructureBackupLeaseClaimPatch,
    buildStructureBackupLeaseClearPatch,
    buildStructureBackupSettingsDocument,
    buildStructureBackupSettingsPatch,
    buildStructureDriftLeaseClaimPatch,
    buildStructureDriftLeaseClearPatch,
    buildStructureScheduledDriftResultPatch,
    chooseLatestStructureDriftBaselineBackup,
    buildStructureImportActionDocument,
    buildStructureImportRunDocument,
    buildStructureImportRunStatusPatch,
    normalizeBackupName,
    normalizeBackupRetentionDays,
    normalizeLimit,
    normalizeRequiredGuildId,
    STRUCTURE_BACKUP_SOURCE,
    STRUCTURE_BACKUP_STATUS,
    toStructureBackupRecord,
    toStructureBackupSettingsRecord,
    toStructureBackupSummaryRecord,
    toStructureImportActionRecord,
    toStructureImportRunRecord,
    toStructureObservedEventStateRecord,
    type StructureBackupDocument,
    type StructureBackupSettingsDocument,
    type StructureImportActionDocument,
    type StructureImportRunDocument,
    type StructureObservedEventStateDocument,
} from './structure_model.js';

type StructureQueryCtx = QueryCtx;
type StructureMutationCtx = MutationCtx;
type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredBackupDocument = StructureBackupDocument & { _id: GenericId<'structureBackups'> };
type StoredBackupSettingsDocument = StructureBackupSettingsDocument & { _id: GenericId<'structureBackupSettings'> };
type StoredImportRunDocument = StructureImportRunDocument & { _id: GenericId<'structureImportRuns'> };
type StoredImportActionDocument = StructureImportActionDocument & { _id: GenericId<'structureImportActions'> };
type StoredObservedEventDocument = StructureObservedEventStateDocument & { _id: GenericId<'guildFeatureSettings'> };

const allowedStructureServices = ['bot', 'web'] as const;
const structureFeature = 'import_export';
const nullableString = v.union(v.string(), v.null());
const auditInputValidator = v.object({
    action: v.string(),
    actorUserId: v.optional(v.union(v.string(), v.null())),
    metadata: v.optional(v.any()),
    targetId: v.optional(v.union(v.string(), v.null())),
});
const backupRecordValidator = v.object({
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
    source: v.string(),
    status: v.string(),
    structure: v.union(v.any(), v.null()),
});
const backupSummaryRecordValidator = v.object({
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
    source: v.string(),
    status: v.string(),
});
const backupSettingsValidator = v.object({
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
const backupSummaryPageValidator = v.object({
    backups: v.array(backupSummaryRecordValidator),
    nextCursor: nullableString,
});
const backupRetentionPruneResultValidator = v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
    nextRetentionPruneAt: nullableString,
});
const actionRecordValidator = v.object({
    actionType: v.string(),
    createdAt: v.string(),
    details: v.any(),
    id: v.string(),
    runId: v.string(),
    sequence: v.number(),
    status: v.string(),
    targetId: nullableString,
    targetType: v.string(),
    updatedAt: v.string(),
});
const actionPageValidator = v.object({
    actions: v.array(actionRecordValidator),
    nextCursor: nullableString,
});
const runRecordValidator = v.object({
    appliedAt: nullableString,
    confirmedAt: nullableString,
    createdAt: v.string(),
    createdByUserId: nullableString,
    guildId: v.string(),
    id: v.string(),
    plan: v.any(),
    sourceBackupId: nullableString,
    status: v.string(),
    updatedAt: v.string(),
});
const observedStateValidator = v.object({
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
const importActionInputValidator = v.object({
    actionType: v.string(),
    details: v.optional(v.any()),
    sequence: v.number(),
    status: v.optional(v.string()),
    targetId: v.optional(v.union(v.string(), v.null())),
    targetType: v.string(),
});

export const findStructureObservedEventStateByGuildId = query({
    args: { guildId: v.string() },
    returns: observedStateValidator,
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const state = await findObservedEventDocument(ctx, guildId);

        return state
            ? toStructureObservedEventStateRecord(state)
            : { guildId, observedChangeCount: 0, targetChangeCounts: {} };
    },
});

export const recordStructureObservedEvent = mutation({
    args: {
        eventType: v.string(),
        guildId: v.string(),
        targetId: v.optional(v.union(v.string(), v.null())),
        targetType: v.string(),
    },
    returns: observedStateValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existing = await findObservedEventDocument(ctx, guildId);
        const current = existing
            ? toStructureObservedEventStateRecord(existing)
            : { guildId, observedChangeCount: 0, targetChangeCounts: {} };
        const document = unwrap(
            buildObservedEventStateDocument(
                { ...args, guildId },
                current,
                new Date().toISOString(),
                existing ?? undefined
            )
        );

        if (existing) {
            await ctx.db.patch('guildFeatureSettings', existing._id, {
                config: document.config,
                enabled: true,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('guildFeatureSettings', document);
        }

        return toStructureObservedEventStateRecord(document);
    },
});

export const createStructureBackup = mutation({
    args: {
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
    },
    returns: backupRecordValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const now = new Date().toISOString();
        const createdAt = normalizeTimestamp(args.createdAt) ?? now;
        const document = unwrap(
            buildStructureBackupDocument(
                {
                    ...args,
                    createdAt,
                    guildId,
                    sortKey: buildBackupSortCursor({ createdAt, id: crypto.randomUUID() }),
                },
                now
            )
        );
        const id = await ctx.db.insert('structureBackups', document);
        if (document.source !== STRUCTURE_BACKUP_SOURCE.restorePoint) {
            await recordBackupAttempt(ctx, guildId, document.status, document.errorMessage, now);
        }
        await recordStructureAuditInMutation(ctx, guildId, args.audit, now, id);

        return toStructureBackupRecord({ ...document, _id: id });
    },
});

export const listStructureBackupsByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(backupRecordValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const backups = await ctx.db
            .query('structureBackups')
            .withIndex('by_guild_created', (index) => index.eq('guildId', guildId))
            .order('desc')
            .take(normalizeLimit(args.limit));

        return backups.map(toStructureBackupRecord);
    },
});

export const listStructureBackupSummariesByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(backupSummaryRecordValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const backups = await ctx.db
            .query('structureBackups')
            .withIndex('by_guild_created', (index) => index.eq('guildId', guildId))
            .order('desc')
            .take(normalizeLimit(args.limit));

        return backups.map(toStructureBackupSummaryRecord);
    },
});

export const listStructureBackupSummaryPageByGuildId = query({
    args: {
        cursor: v.optional(v.union(v.string(), v.null())),
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: backupSummaryPageValidator,
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const limit = normalizeLimit(args.limit);
        const cursor = normalizeBackupSortCursor(args.cursor);
        const queryWithCursor = cursor
            ? ctx.db
                  .query('structureBackups')
                  .withIndex('by_guild_sort_key', (index) => index.eq('guildId', guildId).lt('sortKey', cursor))
            : ctx.db.query('structureBackups').withIndex('by_guild_sort_key', (index) => index.eq('guildId', guildId));
        const backups = await queryWithCursor.order('desc').take(limit + 1);
        const page = backups.slice(0, limit);
        const extra = backups.at(limit);

        return {
            backups: page.map(toStructureBackupSummaryRecord),
            nextCursor: extra ? (page.at(-1)?.sortKey ?? extra.sortKey) : null,
        };
    },
});

export const renameStructureBackup = mutation({
    args: { audit: v.optional(auditInputValidator), backupId: v.string(), guildId: v.string(), name: v.string() },
    returns: v.union(backupSummaryRecordValidator, v.null()),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const backup = await findBackupById(ctx, parseBackupId(args.backupId));
        if (backup?.guildId !== guildId) return null;

        const name = normalizeBackupName(args.name, backup.name);
        await ctx.db.patch('structureBackups', backup._id, { name });
        await recordStructureAuditInMutation(ctx, guildId, args.audit, new Date().toISOString(), backup._id);

        return toStructureBackupSummaryRecord({ ...backup, name });
    },
});

export const deleteStructureBackup = mutation({
    args: { audit: v.optional(auditInputValidator), backupId: v.string(), guildId: v.string() },
    returns: v.boolean(),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const backup = await findBackupById(ctx, parseBackupId(args.backupId));
        if (backup?.guildId !== guildId) return false;

        await ctx.db.delete('structureBackups', backup._id);
        await recordStructureAuditInMutation(ctx, guildId, args.audit, new Date().toISOString(), backup._id);

        return true;
    },
});

export const findStructureBackupByGuildId = query({
    args: { backupId: v.string(), guildId: v.string() },
    returns: v.union(backupRecordValidator, v.null()),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const backup = await findBackupById(ctx, parseBackupId(args.backupId));

        return backup?.guildId === args.guildId ? toStructureBackupRecord(backup) : null;
    },
});

export const findLatestStructureDriftBaselineBackupByGuildId = query({
    args: { guildId: v.string() },
    returns: v.union(backupRecordValidator, v.null()),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const candidates = await Promise.all([
            findLatestBackupBySourceAndStatus(
                ctx,
                guildId,
                STRUCTURE_BACKUP_SOURCE.manual,
                STRUCTURE_BACKUP_STATUS.succeeded
            ),
            findLatestBackupBySourceAndStatus(
                ctx,
                guildId,
                STRUCTURE_BACKUP_SOURCE.scheduled,
                STRUCTURE_BACKUP_STATUS.succeeded
            ),
        ]);
        const latest = chooseLatestStructureDriftBaselineBackup(
            candidates.filter((backup): backup is StoredBackupDocument => Boolean(backup))
        );

        return latest ? toStructureBackupRecord(latest) : null;
    },
});

export const findStructureBackupSettingsByGuildId = query({
    args: { guildId: v.string() },
    returns: backupSettingsValidator,
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const settings = await findBackupSettingsDocument(ctx, guildId);

        return toStructureBackupSettingsRecord(settings ?? undefined, guildId);
    },
});

export const upsertStructureBackupSettings = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        cadenceWeeks: v.optional(v.number()),
        enabled: v.boolean(),
        guildId: v.string(),
        retentionDays: v.optional(v.number()),
    },
    returns: backupSettingsValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        await requireGuildDocument(ctx, guildId);

        const now = new Date().toISOString();
        const existing = await findBackupSettingsDocument(ctx, guildId);
        const patch = unwrap(buildStructureBackupSettingsPatch(existing ?? undefined, args, now));

        if (existing) {
            await ctx.db.patch('structureBackupSettings', existing._id, patch);
            const updated = await findBackupSettingsDocument(ctx, guildId);
            await recordStructureAuditInMutation(ctx, guildId, args.audit, now, guildId);
            return toStructureBackupSettingsRecord(updated ?? undefined, guildId);
        }

        const document = unwrap(buildStructureBackupSettingsDocument({ ...args, guildId }, now));
        await ctx.db.insert('structureBackupSettings', document);
        await recordStructureAuditInMutation(ctx, guildId, args.audit, now, guildId);

        return toStructureBackupSettingsRecord(document, guildId);
    },
});

export const listDueStructureBackupSettings = query({
    args: { limit: v.optional(v.number()), now: v.string() },
    returns: v.array(backupSettingsValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const now = normalizeTimestamp(args.now);
        if (!now) return [];
        const limit = normalizeLimit(args.limit);

        const settings = await ctx.db
            .query('structureBackupSettings')
            .withIndex('by_enabled_next_backup', (index) => index.eq('enabled', true).lte('nextBackupAt', now))
            .take(Math.min(limit * 4, 100));

        return settings
            .filter((setting) => !hasActiveBackupLease(setting, now))
            .slice(0, limit)
            .map((setting) => toStructureBackupSettingsRecord(setting, setting.guildId));
    },
});

export const listDueStructureDriftSettings = query({
    args: { limit: v.optional(v.number()), now: v.string() },
    returns: v.array(backupSettingsValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const now = normalizeTimestamp(args.now);
        if (!now) return [];
        const limit = normalizeLimit(args.limit);

        const settings = await ctx.db
            .query('structureBackupSettings')
            .withIndex('by_enabled_next_drift_check', (index) => index.eq('enabled', true))
            .take(Math.min(limit * 4, 100));

        return settings
            .filter((setting) => isDriftDue(setting, now) && !hasActiveDriftLease(setting, now))
            .slice(0, limit)
            .map((setting) => toStructureBackupSettingsRecord(setting, setting.guildId));
    },
});

export const listDueStructureBackupRetentionSettings = query({
    args: { limit: v.optional(v.number()), now: v.string() },
    returns: v.array(backupSettingsValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const now = normalizeTimestamp(args.now);
        if (!now) return [];
        const limit = normalizeLimit(args.limit);

        const settings = await ctx.db
            .query('structureBackupSettings')
            .withIndex('by_next_retention_prune', (index) => index.lte('nextRetentionPruneAt', now))
            .take(limit);

        return settings.map((setting) => toStructureBackupSettingsRecord(setting, setting.guildId));
    },
});

export const pruneExpiredStructureBackupsForGuild = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        guildId: v.string(),
        limit: v.optional(v.number()),
        now: v.string(),
    },
    returns: backupRetentionPruneResultValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const now = normalizeTimestamp(args.now);
        if (!now) throw new Error('now-invalid-value');

        const settings = await findBackupSettingsDocument(ctx, guildId);
        if (!settings) {
            return { deletedCount: 0, hasMore: false, nextRetentionPruneAt: null };
        }

        const limit = normalizeLimit(args.limit, 100);
        const retentionDays = normalizeBackupRetentionDays(settings.retentionDays);
        const cutoff = new Date(Date.parse(now) - retentionDays * 24 * 60 * 60 * 1000).toISOString();
        const expiredBackups = await ctx.db
            .query('structureBackups')
            .withIndex('by_guild_sort_key', (index) =>
                index.eq('guildId', guildId).lt('sortKey', maxBackupSortKeyForTimestamp(cutoff))
            )
            .order('asc')
            .take(limit + 1);
        const page = expiredBackups.slice(0, limit);
        const hasMore = expiredBackups.length > limit;

        for (const backup of page) {
            await ctx.db.delete('structureBackups', backup._id);
        }

        const nextRetentionPruneAt = hasMore ? now : addDays(now, 1);
        await ctx.db.patch('structureBackupSettings', settings._id, {
            nextRetentionPruneAt,
            retentionDays,
            updatedAt: now,
        });
        if (page.length > 0) {
            await recordStructureAuditInMutation(
                ctx,
                guildId,
                args.audit
                    ? {
                          ...args.audit,
                          metadata: {
                              ...(isObjectRecord(args.audit.metadata) ? args.audit.metadata : {}),
                              deletedCount: page.length,
                              hasMore,
                              nextRetentionPruneAt,
                              retentionDays,
                          },
                      }
                    : undefined,
                now,
                guildId
            );
        }

        return { deletedCount: page.length, hasMore, nextRetentionPruneAt };
    },
});

export const claimDueStructureBackupSetting = mutation({
    args: {
        guildId: v.string(),
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
    },
    returns: v.union(backupSettingsValidator, v.null()),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        await requireGuildDocument(ctx, guildId);

        const now = normalizeTimestamp(args.now);
        if (!now) throw new Error('now-invalid-value');

        const existing = await findBackupSettingsDocument(ctx, guildId);
        const patch = unwrap(
            buildStructureBackupLeaseClaimPatch(
                existing ?? undefined,
                {
                    leaseExpiresAt: args.leaseExpiresAt,
                    leaseId: args.leaseId,
                    leaseOwner: args.leaseOwner,
                },
                now
            )
        );

        if (!existing || !patch) return null;

        await ctx.db.patch('structureBackupSettings', existing._id, patch);
        const updated = await findBackupSettingsDocument(ctx, guildId);

        return updated ? toStructureBackupSettingsRecord(updated, guildId) : null;
    },
});

export const clearStructureBackupSettingLease = mutation({
    args: {
        guildId: v.string(),
        leaseId: v.string(),
        now: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const now = normalizeTimestamp(args.now);
        if (!now) throw new Error('now-invalid-value');

        const existing = await findBackupSettingsDocument(ctx, guildId);
        const patch = unwrap(
            buildStructureBackupLeaseClearPatch(existing ?? undefined, { leaseId: args.leaseId }, now)
        );

        if (!existing || !patch) return false;

        await ctx.db.patch('structureBackupSettings', existing._id, patch);

        return true;
    },
});

export const claimDueStructureDriftSetting = mutation({
    args: {
        guildId: v.string(),
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
    },
    returns: v.union(backupSettingsValidator, v.null()),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        await requireGuildDocument(ctx, guildId);

        const now = normalizeTimestamp(args.now);
        if (!now) throw new Error('now-invalid-value');

        const existing = await findBackupSettingsDocument(ctx, guildId);
        const patch = unwrap(
            buildStructureDriftLeaseClaimPatch(
                existing ?? undefined,
                {
                    leaseExpiresAt: args.leaseExpiresAt,
                    leaseId: args.leaseId,
                    leaseOwner: args.leaseOwner,
                },
                now
            )
        );

        if (!existing || !patch) return null;

        await ctx.db.patch('structureBackupSettings', existing._id, patch);
        const updated = await findBackupSettingsDocument(ctx, guildId);

        return updated ? toStructureBackupSettingsRecord(updated, guildId) : null;
    },
});

export const clearStructureDriftSettingLease = mutation({
    args: {
        guildId: v.string(),
        leaseId: v.string(),
        now: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const now = normalizeTimestamp(args.now);
        if (!now) throw new Error('now-invalid-value');

        const existing = await findBackupSettingsDocument(ctx, guildId);
        const patch = unwrap(buildStructureDriftLeaseClearPatch(existing ?? undefined, { leaseId: args.leaseId }, now));

        if (!existing || !patch) return false;

        await ctx.db.patch('structureBackupSettings', existing._id, patch);

        return true;
    },
});

export const recordStructureScheduledDriftResult = mutation({
    args: {
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
    },
    returns: backupSettingsValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const now = normalizeTimestamp(args.now);
        if (!now) throw new Error('now-invalid-value');

        const existing = await findBackupSettingsDocument(ctx, guildId);
        if (!existing) throw new Error('settings-not-found');

        const patch = unwrap(buildStructureScheduledDriftResultPatch(existing, args, now));
        await ctx.db.patch('structureBackupSettings', existing._id, patch);
        await recordStructureAuditInMutation(ctx, guildId, args.audit, now, guildId);
        const updated = await findBackupSettingsDocument(ctx, guildId);
        if (!updated) throw new Error('settings-not-found');

        return toStructureBackupSettingsRecord(updated, guildId);
    },
});

export const createStructureImportRun = mutation({
    args: {
        createdAt: v.optional(v.string()),
        createdByUserId: v.optional(v.union(v.string(), v.null())),
        guildId: v.string(),
        plan: v.optional(v.any()),
        sourceBackupId: v.optional(v.union(v.string(), v.null())),
    },
    returns: runRecordValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        await requireSourceBackupIfProvided(ctx, { guildId, sourceBackupId: args.sourceBackupId });

        const document = unwrap(buildStructureImportRunDocument({ ...args, guildId }, new Date().toISOString()));
        const id = await ctx.db.insert('structureImportRuns', document);

        return toStructureImportRunRecord({ ...document, _id: id });
    },
});

export const listStructureImportRunsByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(runRecordValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const runs = await ctx.db
            .query('structureImportRuns')
            .withIndex('by_guild_created', (index) => index.eq('guildId', guildId))
            .order('desc')
            .take(normalizeLimit(args.limit));

        return runs.map(toStructureImportRunRecord);
    },
});

export const findStructureImportRunByGuildId = query({
    args: { guildId: v.string(), runId: v.string() },
    returns: v.union(runRecordValidator, v.null()),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const run = await findRunById(ctx, parseRunId(args.runId));

        return run?.guildId === args.guildId ? toStructureImportRunRecord(run) : null;
    },
});

export const updateStructureImportRunStatus = mutation({
    args: { audit: v.optional(auditInputValidator), plan: v.optional(v.any()), runId: v.string(), status: v.string() },
    returns: v.union(runRecordValidator, v.null()),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const run = await findRunById(ctx, parseRunId(args.runId));
        if (!run) return null;

        const patch = unwrap(buildStructureImportRunStatusPatch(run, args, new Date().toISOString()));
        await ctx.db.patch('structureImportRuns', run._id, patch);
        await recordStructureAuditInMutation(ctx, run.guildId, args.audit, patch.updatedAt, run._id);

        return toStructureImportRunRecord({ ...run, ...patch });
    },
});

export const recordStructureImportAction = mutation({
    args: {
        actionType: v.string(),
        details: v.optional(v.any()),
        runId: v.string(),
        sequence: v.number(),
        status: v.optional(v.string()),
        targetId: v.optional(v.union(v.string(), v.null())),
        targetType: v.string(),
    },
    returns: actionRecordValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const run = await requireRun(ctx, args.runId);

        await assertAvailableImportActionSequence(ctx, run._id, args.sequence);

        const document = unwrap(buildStructureImportActionDocument(args, new Date().toISOString()));
        const id = await ctx.db.insert('structureImportActions', document);

        return toStructureImportActionRecord({ ...document, _id: id });
    },
});

export const recordStructureImportActionsBatch = mutation({
    args: { actions: v.array(importActionInputValidator), runId: v.string() },
    returns: v.array(actionRecordValidator),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        if (args.actions.length < 1 || args.actions.length > 100) {
            throw new Error('structure-import-action-batch-size-invalid');
        }

        const run = await requireRun(ctx, args.runId);
        assertUniqueActionSequences(args.actions.map((action) => action.sequence));

        const now = new Date().toISOString();
        const records = [];
        for (const action of args.actions) {
            await assertAvailableImportActionSequence(ctx, run._id, action.sequence);
            const document = unwrap(buildStructureImportActionDocument({ ...action, runId: args.runId }, now));
            const id = await ctx.db.insert('structureImportActions', document);
            records.push(toStructureImportActionRecord({ ...document, _id: id }));
        }

        return records;
    },
});

export const listStructureImportActionsByRunIdPage = query({
    args: { cursor: v.optional(v.union(v.string(), v.null())), limit: v.optional(v.number()), runId: v.string() },
    returns: actionPageValidator,
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const runId = parseRunId(args.runId);
        const limit = normalizeLimit(args.limit);
        const cursor = normalizeCursor(args.cursor);
        const queryWithCursor =
            cursor === undefined
                ? ctx.db
                      .query('structureImportActions')
                      .withIndex('by_run_sequence', (index) => index.eq('runId', runId))
                : ctx.db
                      .query('structureImportActions')
                      .withIndex('by_run_sequence', (index) => index.eq('runId', runId).gt('sequence', cursor));
        const actions = await queryWithCursor.order('asc').take(limit + 1);
        const page = actions.slice(0, limit);
        const extra = actions.at(limit);

        return {
            actions: page.map(toStructureImportActionRecord),
            nextCursor: extra ? String(page.at(-1)?.sequence ?? extra.sequence) : null,
        };
    },
});

export const updateStructureImportActionStatus = mutation({
    args: { actionId: v.string(), details: v.optional(v.any()), status: v.string() },
    returns: v.union(actionRecordValidator, v.null()),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const action = await findActionById(ctx, parseActionId(args.actionId));
        if (!action) return null;

        const details = isObjectRecord(args.details) ? args.details : action.details;
        const updatedAt = new Date().toISOString();

        await ctx.db.patch('structureImportActions', action._id, { details, status: args.status, updatedAt });

        return toStructureImportActionRecord({ ...action, details, status: args.status, updatedAt });
    },
});

async function recordBackupAttempt(
    ctx: StructureMutationCtx,
    guildId: string,
    status: string,
    errorMessage: string | undefined,
    now: string
): Promise<void> {
    const existing = await findBackupSettingsDocument(ctx, guildId);
    const patch = buildStructureBackupAttemptPatch(
        existing ?? undefined,
        { ...(errorMessage ? { errorMessage } : {}), status },
        now
    );

    if (existing) {
        await ctx.db.patch('structureBackupSettings', existing._id, patch);
        return;
    }

    const document = unwrap(buildStructureBackupSettingsDocument({ enabled: false, guildId }, now));
    const backupSettingsDocument: StructureBackupSettingsDocument = {
        ...document,
        cadenceWeeks: patch.cadenceWeeks ?? document.cadenceWeeks,
        enabled: patch.enabled ?? document.enabled,
        ...(patch.lastAttemptAt ? { lastAttemptAt: patch.lastAttemptAt } : {}),
        ...(patch.lastErrorMessage ? { lastErrorMessage: patch.lastErrorMessage } : {}),
        ...(patch.lastSuccessAt ? { lastSuccessAt: patch.lastSuccessAt } : {}),
        ...(patch.nextBackupAt ? { nextBackupAt: patch.nextBackupAt } : {}),
        ...(patch.nextRetentionPruneAt ? { nextRetentionPruneAt: patch.nextRetentionPruneAt } : {}),
        retentionDays: patch.retentionDays ?? document.retentionDays,
        updatedAt: patch.updatedAt,
    };
    await ctx.db.insert('structureBackupSettings', backupSettingsDocument);
}

async function findObservedEventDocument(
    ctx: StructureQueryCtx | StructureMutationCtx,
    guildId: string
): Promise<StoredObservedEventDocument | null> {
    const row = await ctx.db
        .query('guildFeatureSettings')
        .withIndex('by_guild_feature', (index) => index.eq('guildId', guildId).eq('feature', 'import_export'))
        .unique();

    return row as StoredObservedEventDocument | null;
}

async function findBackupById(
    ctx: StructureQueryCtx | StructureMutationCtx,
    backupId: GenericId<'structureBackups'>
): Promise<StoredBackupDocument | null> {
    return await ctx.db.get('structureBackups', backupId);
}

async function findLatestBackupBySourceAndStatus(
    ctx: StructureQueryCtx,
    guildId: string,
    source: string,
    status: string
): Promise<StoredBackupDocument | null> {
    return await ctx.db
        .query('structureBackups')
        .withIndex('by_guild_source_status_sort_key', (index) =>
            index.eq('guildId', guildId).eq('source', source).eq('status', status)
        )
        .order('desc')
        .first();
}

async function findBackupSettingsDocument(
    ctx: StructureQueryCtx | StructureMutationCtx,
    guildId: string
): Promise<StoredBackupSettingsDocument | null> {
    return await ctx.db
        .query('structureBackupSettings')
        .withIndex('by_guild', (index) => index.eq('guildId', guildId))
        .unique();
}

function hasActiveBackupLease(setting: StructureBackupSettingsDocument, now: string): boolean {
    const leaseExpiresAt = Date.parse(setting.backupLeaseExpiresAt ?? '');
    const parsedNow = Date.parse(now);

    return Number.isFinite(leaseExpiresAt) && Number.isFinite(parsedNow) && leaseExpiresAt > parsedNow;
}

function hasActiveDriftLease(setting: StructureBackupSettingsDocument, now: string): boolean {
    const leaseExpiresAt = Date.parse(setting.driftLeaseExpiresAt ?? '');
    const parsedNow = Date.parse(now);

    return Number.isFinite(leaseExpiresAt) && Number.isFinite(parsedNow) && leaseExpiresAt > parsedNow;
}

function isDriftDue(setting: StructureBackupSettingsDocument, now: string): boolean {
    if (!setting.enabled) return false;

    const parsedNow = Date.parse(now);
    const parsedNextDriftCheckAt = Date.parse(setting.nextDriftCheckAt ?? now);

    return Number.isFinite(parsedNow) && Number.isFinite(parsedNextDriftCheckAt) && parsedNextDriftCheckAt <= parsedNow;
}

async function findRunById(
    ctx: StructureQueryCtx | StructureMutationCtx,
    runId: GenericId<'structureImportRuns'>
): Promise<StoredImportRunDocument | null> {
    return await ctx.db.get('structureImportRuns', runId);
}

async function findActionById(
    ctx: StructureMutationCtx,
    actionId: GenericId<'structureImportActions'>
): Promise<StoredImportActionDocument | null> {
    return await ctx.db.get('structureImportActions', actionId);
}

async function requireSourceBackupIfProvided(
    ctx: StructureMutationCtx,
    input: { guildId: string; sourceBackupId?: string | null | undefined }
): Promise<void> {
    const sourceBackupId = normalizeOptionalString(input.sourceBackupId);
    if (!sourceBackupId) return;

    const backup = await findBackupById(ctx, parseBackupId(sourceBackupId));
    if (backup?.guildId !== input.guildId) throw new Error('structure-backup-not-found');
}

async function requireRun(ctx: StructureMutationCtx, runId: string): Promise<StoredImportRunDocument> {
    const run = await findRunById(ctx, parseRunId(runId));
    if (!run) throw new Error('structure-import-run-not-found');
    return run;
}

async function assertAvailableImportActionSequence(
    ctx: StructureMutationCtx,
    runId: GenericId<'structureImportRuns'>,
    sequence: number
): Promise<void> {
    const existing = await ctx.db
        .query('structureImportActions')
        .withIndex('by_run_sequence', (index) => index.eq('runId', runId).eq('sequence', sequence))
        .first();

    if (existing) {
        throw new Error('structure-import-action-sequence-duplicate');
    }
}

async function recordStructureAuditInMutation(
    ctx: StructureMutationCtx,
    guildId: string,
    audit: { action: string; actorUserId?: string | null; metadata?: unknown; targetId?: string | null } | undefined,
    now: string,
    defaultTargetId: string
): Promise<void> {
    if (!audit) return;

    const document = unwrap(
        buildBotActionEventDocument(
            {
                action: audit.action,
                feature: structureFeature,
                guildId,
                metadata: audit.metadata,
                targetId: audit.targetId ?? defaultTargetId,
                ...(audit.actorUserId ? { actorUserId: audit.actorUserId } : {}),
            },
            now
        )
    );

    await ctx.db.insert('botActionEvents', document);
    await markDashboardLiveAreasChangedInMutation(ctx, {
        areas: dashboardLiveAreasForBotActionFeature(document.feature),
        guildId,
        now: document.createdAt,
    });
}

function assertUniqueActionSequences(sequences: number[]): void {
    const uniqueSequences = new Set(sequences);

    if (uniqueSequences.size !== sequences.length) {
        throw new Error('structure-import-action-sequence-duplicate');
    }
}

async function requireGuildDocument(ctx: StructureMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (index) => index.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');
    return guild;
}

function normalizeCursor(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const cursor = Number(value);
    return Number.isInteger(cursor) && cursor >= 0 ? cursor : undefined;
}

function normalizeBackupSortCursor(value: string | null | undefined): string | undefined {
    const normalized = normalizeOptionalString(value);
    if (!normalized) return undefined;

    const [timestamp, id] = normalized.split('|', 2);
    return normalizeTimestamp(timestamp) && id ? normalized : undefined;
}

function maxBackupSortKeyForTimestamp(timestamp: string): string {
    return `${timestamp}|\uffff`;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRequiredString(value: string, field: string): string {
    const normalizedValue = normalizeOptionalString(value);
    if (!normalizedValue) throw new Error(`${field}-missing-input`);
    return normalizedValue;
}

function parseBackupId(backupId: string): GenericId<'structureBackups'> {
    return unwrapRequiredString(backupId, 'backupId') as GenericId<'structureBackups'>;
}

function parseRunId(runId: string): GenericId<'structureImportRuns'> {
    return unwrapRequiredString(runId, 'runId') as GenericId<'structureImportRuns'>;
}

function parseActionId(actionId: string): GenericId<'structureImportActions'> {
    return unwrapRequiredString(actionId, 'actionId') as GenericId<'structureImportActions'>;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;
        if (typeof error === 'object' && error !== null && 'type' in error) throw new Error(String(error.type));
        throw new Error(String(error));
    }
    return result.value;
}
