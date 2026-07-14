import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { dashboardLiveAreasForBotActionFeature } from '../core/dashboard_live_model.js';
import { buildBotActionEventDocument, buildBotActionEventSortKey } from '../core/events_model.js';
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
    buildBlueprintPlanStepDocument,
    buildBlueprintPlanDocument,
    normalizeBackupName,
    normalizeBackupRetentionDays,
    isStructureBackupRetentionEligible,
    normalizeLimit,
    normalizeRequiredGuildId,
    STRUCTURE_BACKUP_SOURCE,
    STRUCTURE_BACKUP_STATUS,
    BLUEPRINT_PLAN_STATUS,
    toStructureBackupRecord,
    toStructureBackupSettingsRecord,
    toStructureBackupSummaryRecord,
    toBlueprintPlanStepRecord,
    toBlueprintPlanRecord,
    toStructureObservedEventStateRecord,
    type StructureBackupDocument,
    type StructureBackupSettingsDocument,
    type BlueprintPlanDocument,
    type StructureObservedEventStateDocument,
} from './blueprint_model.js';

type StructureQueryCtx = QueryCtx;
type StructureMutationCtx = MutationCtx;
type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredBackupDocument = StructureBackupDocument & { _id: GenericId<'structureBackups'> };
type StoredBackupSettingsDocument = StructureBackupSettingsDocument & { _id: GenericId<'structureBackupSettings'> };
type StoredBlueprintPlanDocument = BlueprintPlanDocument & { _id: GenericId<'blueprintPlans'> };
type StoredObservedEventDocument = StructureObservedEventStateDocument & { _id: GenericId<'guildFeatureSettings'> };

const allowedStructureServices = ['bot', 'web'] as const;
const blueprintFeature = 'blueprint';
// Restore points remain available for operator reconciliation even when regular backup retention is shorter.
const restorePointMinimumRecoveryDays = 30;
const protectedRestorePointRunStatuses = [
    'queued',
    'running',
    'waiting_rate_limit',
    'pause_requested',
    'paused',
    'verifying',
    'partially_applied',
    'needs_reconciliation',
    'outcome_unknown',
] as const;
const nullableString = v.union(v.string(), v.null());
const backupSourceValidator = v.union(v.literal('manual'), v.literal('scheduled'), v.literal('restore_point'));
const backupStatusValidator = v.union(v.literal('succeeded'), v.literal('failed'));
export const auditInputValidator = v.object({
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
    source: backupSourceValidator,
    status: backupStatusValidator,
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
    source: backupSourceValidator,
    status: backupStatusValidator,
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
const planStepRecordValidator = v.object({
    actionType: v.string(),
    createdAt: v.string(),
    details: v.any(),
    id: v.string(),
    planId: v.string(),
    sequence: v.number(),
    targetId: nullableString,
    targetType: v.string(),
});
const planStepPageValidator = v.object({
    steps: v.array(planStepRecordValidator),
    nextCursor: nullableString,
});
const planRecordValidator = v.object({
    createdAt: v.string(),
    createdByUserId: nullableString,
    guildId: v.string(),
    deleteStepCount: v.number(),
    deleteSetDigest: nullableString,
    planDigest: v.string(),
    planVersion: v.number(),
    policy: v.union(v.literal('merge'), v.literal('synchronize'), v.literal('rebuild')),
    id: v.string(),
    plan: v.any(),
    requestedSnapshotDigest: v.string(),
    sourceBackupId: nullableString,
    status: v.union(
        v.literal('draft'),
        v.literal('needs_input'),
        v.literal('review_ready'),
        v.literal('approved'),
        v.literal('obsolete')
    ),
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
const blueprintPlanStepInputValidator = v.object({
    actionType: v.string(),
    details: v.optional(v.any()),
    sequence: v.number(),
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
        await recordBlueprintAuditInMutation(ctx, guildId, args.audit, now, id);

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
        await recordBlueprintAuditInMutation(ctx, guildId, args.audit, new Date().toISOString(), backup._id);

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
        const now = new Date().toISOString();
        if (backup.source === STRUCTURE_BACKUP_SOURCE.restorePoint) {
            const minimumDeleteAt = addDays(backup.createdAt, restorePointMinimumRecoveryDays);
            if (minimumDeleteAt > now) throw new Error('structure-restore-point-recovery-window-active');
            for (const status of protectedRestorePointRunStatuses) {
                const references = await ctx.db
                    .query('blueprintRuns')
                    .withIndex('by_guild_status', (index) => index.eq('guildId', guildId).eq('status', status))
                    .collect();
                if (references.some((run) => run.restorePointBackupId === String(backup._id))) {
                    throw new Error('blueprint-restore-point-run-active');
                }
            }
        }

        await ctx.db.delete('structureBackups', backup._id);
        await recordBlueprintAuditInMutation(ctx, guildId, args.audit, now, backup._id);

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
            await recordBlueprintAuditInMutation(ctx, guildId, args.audit, now, guildId);
            return toStructureBackupSettingsRecord(updated ?? undefined, guildId);
        }

        const document = unwrap(buildStructureBackupSettingsDocument({ ...args, guildId }, now));
        await ctx.db.insert('structureBackupSettings', document);
        await recordBlueprintAuditInMutation(ctx, guildId, args.audit, now, guildId);

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

        const dueSettings = [];

        for (const setting of settings) {
            if (!hasActiveBackupLease(setting, now) && (await isGuildInEffectiveBotScope(ctx, setting.guildId))) {
                dueSettings.push(toStructureBackupSettingsRecord(setting, setting.guildId));
            }

            if (dueSettings.length >= limit) break;
        }

        return dueSettings;
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

        const dueSettings = [];

        for (const setting of settings) {
            if (
                isDriftDue(setting, now) &&
                !hasActiveDriftLease(setting, now) &&
                (await isGuildInEffectiveBotScope(ctx, setting.guildId))
            ) {
                dueSettings.push(toStructureBackupSettingsRecord(setting, setting.guildId));
            }

            if (dueSettings.length >= limit) break;
        }

        return dueSettings;
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
        const restorePointCutoff = new Date(
            Date.parse(now) - restorePointMinimumRecoveryDays * 24 * 60 * 60 * 1000
        ).toISOString();
        const protectedRestorePointIds = new Set<string>();
        for (const status of protectedRestorePointRunStatuses) {
            const runs = await ctx.db
                .query('blueprintRuns')
                .withIndex('by_guild_status', (index) => index.eq('guildId', guildId).eq('status', status))
                .collect();
            for (const run of runs) {
                if (run.restorePointBackupId) protectedRestorePointIds.add(run.restorePointBackupId);
            }
        }
        const expiredBackups = await ctx.db
            .query('structureBackups')
            .withIndex('by_guild_sort_key', (index) =>
                index.eq('guildId', guildId).lt('sortKey', maxBackupSortKeyForTimestamp(cutoff))
            )
            .order('asc')
            .take(limit * 10 + 1);
        const eligibleBackups = expiredBackups.filter((backup) =>
            isStructureBackupRetentionEligible(
                { createdAt: backup.createdAt, id: String(backup._id), source: backup.source },
                { protectedRestorePointIds, restorePointCutoff }
            )
        );
        const page = eligibleBackups.slice(0, limit);
        const hasMore = eligibleBackups.length > limit;

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
            await recordBlueprintAuditInMutation(
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
        if (!(await isGuildInEffectiveBotScope(ctx, guildId))) return null;

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
        if (!(await isGuildInEffectiveBotScope(ctx, guildId))) return null;

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
        await recordBlueprintAuditInMutation(ctx, guildId, args.audit, now, guildId);
        const updated = await findBackupSettingsDocument(ctx, guildId);
        if (!updated) throw new Error('settings-not-found');

        return toStructureBackupSettingsRecord(updated, guildId);
    },
});

export const createBlueprintPlan = mutation({
    args: {
        createdAt: v.optional(v.string()),
        createdByUserId: v.optional(v.union(v.string(), v.null())),
        guildId: v.string(),
        deleteStepCount: v.number(),
        deleteSetDigest: v.optional(v.string()),
        planDigest: v.string(),
        planVersion: v.number(),
        policy: v.union(v.literal('merge'), v.literal('synchronize'), v.literal('rebuild')),
        plan: v.optional(v.any()),
        requestedSnapshotDigest: v.string(),
        sourceBackupId: v.optional(v.union(v.string(), v.null())),
    },
    returns: planRecordValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        await requireSourceBackupIfProvided(ctx, { guildId, sourceBackupId: args.sourceBackupId });

        const document = unwrap(buildBlueprintPlanDocument({ ...args, guildId }, new Date().toISOString()));
        const id = await ctx.db.insert('blueprintPlans', document);

        return toBlueprintPlanRecord({ ...document, _id: id });
    },
});

export const listBlueprintPlansByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(planRecordValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const plans = await ctx.db
            .query('blueprintPlans')
            .withIndex('by_guild_created', (index) => index.eq('guildId', guildId))
            .order('desc')
            .take(normalizeLimit(args.limit));

        return plans.map(toBlueprintPlanRecord);
    },
});

export const findBlueprintPlanByGuildId = query({
    args: { guildId: v.string(), planId: v.string() },
    returns: v.union(planRecordValidator, v.null()),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const plan = await findPlanById(ctx, parsePlanId(args.planId));

        return plan?.guildId === args.guildId ? toBlueprintPlanRecord(plan) : null;
    },
});

export const recordBlueprintPlanStep = mutation({
    args: {
        actionType: v.string(),
        details: v.optional(v.any()),
        planId: v.string(),
        sequence: v.number(),
        targetId: v.optional(v.union(v.string(), v.null())),
        targetType: v.string(),
    },
    returns: planStepRecordValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const plan = await requirePlan(ctx, args.planId);
        if (plan.status !== BLUEPRINT_PLAN_STATUS.draft) {
            throw new Error('blueprint-plan-step-ledger-immutable');
        }

        await assertAvailableBlueprintPlanStepSequence(ctx, plan._id, args.sequence);

        const document = unwrap(buildBlueprintPlanStepDocument(args, new Date().toISOString()));
        const id = await ctx.db.insert('blueprintPlanSteps', document);

        return toBlueprintPlanStepRecord({ ...document, _id: id });
    },
});

export const recordBlueprintPlanStepsBatch = mutation({
    args: { planId: v.string(), steps: v.array(blueprintPlanStepInputValidator) },
    returns: v.array(planStepRecordValidator),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        if (args.steps.length < 1 || args.steps.length > 100) {
            throw new Error('blueprint-plan-step-batch-size-invalid');
        }

        const plan = await requirePlan(ctx, args.planId);
        if (plan.status !== BLUEPRINT_PLAN_STATUS.draft) {
            throw new Error('blueprint-plan-step-ledger-immutable');
        }
        assertUniquePlanStepSequences(args.steps.map((step) => step.sequence));
        await assertAvailableBlueprintPlanStepSequences(
            ctx,
            plan._id,
            args.steps.map((step) => step.sequence)
        );

        const now = new Date().toISOString();
        const records = [];
        for (const step of args.steps) {
            const document = unwrap(buildBlueprintPlanStepDocument({ ...step, planId: args.planId }, now));
            const id = await ctx.db.insert('blueprintPlanSteps', document);
            records.push(toBlueprintPlanStepRecord({ ...document, _id: id }));
        }

        return records;
    },
});

export const listBlueprintPlanStepsByPlanIdPage = query({
    args: { cursor: v.optional(v.union(v.string(), v.null())), limit: v.optional(v.number()), planId: v.string() },
    returns: planStepPageValidator,
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const planId = parsePlanId(args.planId);
        const limit = normalizeLimit(args.limit);
        const cursor = normalizeCursor(args.cursor);
        const queryWithCursor =
            cursor === undefined
                ? ctx.db
                      .query('blueprintPlanSteps')
                      .withIndex('by_plan_sequence', (index) => index.eq('planId', planId))
                : ctx.db
                      .query('blueprintPlanSteps')
                      .withIndex('by_plan_sequence', (index) => index.eq('planId', planId).gt('sequence', cursor));
        const steps = await queryWithCursor.order('asc').take(limit + 1);
        const page = steps.slice(0, limit);
        const extra = steps.at(limit);

        return {
            steps: page.map(toBlueprintPlanStepRecord),
            nextCursor: extra ? String(page.at(-1)?.sequence ?? extra.sequence) : null,
        };
    },
});

async function recordBackupAttempt(
    ctx: StructureMutationCtx,
    guildId: string,
    status: (typeof STRUCTURE_BACKUP_STATUS)[keyof typeof STRUCTURE_BACKUP_STATUS],
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
        .withIndex('by_guild_feature', (index) => index.eq('guildId', guildId).eq('feature', 'blueprint'))
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
    source: (typeof STRUCTURE_BACKUP_SOURCE)[keyof typeof STRUCTURE_BACKUP_SOURCE],
    status: (typeof STRUCTURE_BACKUP_STATUS)[keyof typeof STRUCTURE_BACKUP_STATUS]
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

async function findPlanById(
    ctx: StructureQueryCtx | StructureMutationCtx,
    planId: GenericId<'blueprintPlans'>
): Promise<StoredBlueprintPlanDocument | null> {
    return await ctx.db.get('blueprintPlans', planId);
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

async function requirePlan(ctx: StructureMutationCtx, planId: string): Promise<StoredBlueprintPlanDocument> {
    const plan = await findPlanById(ctx, parsePlanId(planId));
    if (!plan) throw new Error('blueprint-plan-not-found');
    return plan;
}

async function assertAvailableBlueprintPlanStepSequence(
    ctx: StructureMutationCtx,
    planId: GenericId<'blueprintPlans'>,
    sequence: number
): Promise<void> {
    const existing = await ctx.db
        .query('blueprintPlanSteps')
        .withIndex('by_plan_sequence', (index) => index.eq('planId', planId).eq('sequence', sequence))
        .first();

    if (existing) {
        throw new Error('blueprint-plan-step-sequence-duplicate');
    }
}

async function assertAvailableBlueprintPlanStepSequences(
    ctx: StructureMutationCtx,
    planId: GenericId<'blueprintPlans'>,
    sequences: number[]
): Promise<void> {
    if (sequences.length === 0) return;

    const minSequence = Math.min(...sequences);
    const maxSequence = Math.max(...sequences);
    const requestedSequences = new Set(sequences);
    const existing = await ctx.db
        .query('blueprintPlanSteps')
        .withIndex('by_plan_sequence', (index) =>
            index.eq('planId', planId).gte('sequence', minSequence).lte('sequence', maxSequence)
        )
        .take(sequences.length);

    if (existing.some((step) => requestedSequences.has(step.sequence))) {
        throw new Error('blueprint-plan-step-sequence-duplicate');
    }
}

export async function recordBlueprintAuditInMutation(
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
                feature: blueprintFeature,
                guildId,
                metadata: audit.metadata,
                targetId: audit.targetId ?? defaultTargetId,
                ...(audit.actorUserId ? { actorUserId: audit.actorUserId } : {}),
            },
            now
        )
    );

    const auditEventId = await ctx.db.insert('botActionEvents', document);
    await ctx.db.patch('botActionEvents', auditEventId, {
        sortKey: buildBotActionEventSortKey({ createdAt: document.createdAt, id: auditEventId }),
    });
    await markDashboardLiveAreasChangedInMutation(ctx, {
        areas: dashboardLiveAreasForBotActionFeature(document.feature),
        guildId,
        now: document.createdAt,
    });
}

function assertUniquePlanStepSequences(sequences: number[]): void {
    const uniqueSequences = new Set(sequences);

    if (uniqueSequences.size !== sequences.length) {
        throw new Error('blueprint-plan-step-sequence-duplicate');
    }
}

async function isGuildInEffectiveBotScope(
    ctx: StructureQueryCtx | StructureMutationCtx,
    guildId: string
): Promise<boolean> {
    const [deploymentConfig, installation] = await Promise.all([
        ctx.db.query('deploymentConfig').withIndex('by_config_id').unique(),
        ctx.db
            .query('botInstallations')
            .withIndex('by_guild_id', (index) => index.eq('guildId', guildId))
            .unique(),
    ]);

    if (!deploymentConfig || !installation) return false;

    switch (deploymentConfig.instanceMode) {
        case 'single':
            return deploymentConfig.singleGuildId === guildId;

        case 'multi':
            return true;
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

function parsePlanId(planId: string): GenericId<'blueprintPlans'> {
    return unwrapRequiredString(planId, 'planId') as GenericId<'blueprintPlans'>;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;
        if (typeof error === 'object' && error !== null && 'type' in error) throw new Error(String(error.type));
        throw new Error(String(error));
    }
    return result.value;
}
