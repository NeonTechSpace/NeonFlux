import { requireNeonFluxService } from '../auth.js';
import {
    allowedStructureServices,
    findBackupSettingsDocument,
    isGuildInEffectiveBotScope,
    isObjectRecord,
    maxBackupSortKeyForTimestamp,
    normalizeTimestamp,
    protectedRestorePointRunStatuses,
    requireGuildDocument,
    restorePointMinimumRecoveryDays,
    type StructureMutationCtx,
    type StructureQueryCtx,
    unwrap,
} from './blueprint_backup_access.js';
import type {
    DueSettingsArgs,
    GuildIdArgs,
    LeaseClaimArgs,
    LeaseClearArgs,
    PruneBackupsArgs,
    RecordScheduledDriftResultArgs,
    UpsertBackupSettingsArgs,
} from './blueprint_backup_contract.js';
import { recordBlueprintAuditInMutation } from './blueprint_audit.js';
import {
    addDays,
    buildStructureBackupLeaseClaimPatch,
    buildStructureBackupLeaseClearPatch,
    buildStructureBackupSettingsDocument,
    buildStructureBackupSettingsPatch,
    buildStructureDriftLeaseClaimPatch,
    buildStructureDriftLeaseClearPatch,
    buildStructureScheduledDriftResultPatch,
    isStructureBackupRetentionEligible,
    normalizeBackupRetentionDays,
    normalizeLimit,
    normalizeRequiredGuildId,
    toStructureBackupSettingsRecord,
    type StructureBackupSettingsDocument,
} from './structure_backup_model.js';

export async function findStructureBackupSettingsByGuildIdHandler(ctx: StructureQueryCtx, args: GuildIdArgs) {
    await requireNeonFluxService(ctx, allowedStructureServices);
    const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
    const settings = await findBackupSettingsDocument(ctx, guildId);

    return toStructureBackupSettingsRecord(settings ?? undefined, guildId);
}

export async function upsertStructureBackupSettingsHandler(ctx: StructureMutationCtx, args: UpsertBackupSettingsArgs) {
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
}

export async function listDueStructureBackupSettingsHandler(ctx: StructureQueryCtx, args: DueSettingsArgs) {
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
}

export async function listDueStructureDriftSettingsHandler(ctx: StructureQueryCtx, args: DueSettingsArgs) {
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
}

export async function listDueStructureBackupRetentionSettingsHandler(ctx: StructureQueryCtx, args: DueSettingsArgs) {
    await requireNeonFluxService(ctx, ['bot']);
    const now = normalizeTimestamp(args.now);
    if (!now) return [];
    const limit = normalizeLimit(args.limit);

    const settings = await ctx.db
        .query('structureBackupSettings')
        .withIndex('by_next_retention_prune', (index) => index.lte('nextRetentionPruneAt', now))
        .take(limit);

    return settings.map((setting) => toStructureBackupSettingsRecord(setting, setting.guildId));
}

export async function pruneExpiredStructureBackupsForGuildHandler(ctx: StructureMutationCtx, args: PruneBackupsArgs) {
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
}

export async function claimDueStructureBackupSettingHandler(ctx: StructureMutationCtx, args: LeaseClaimArgs) {
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
}

export async function clearStructureBackupSettingLeaseHandler(ctx: StructureMutationCtx, args: LeaseClearArgs) {
    await requireNeonFluxService(ctx, ['bot']);
    const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
    const now = normalizeTimestamp(args.now);
    if (!now) throw new Error('now-invalid-value');

    const existing = await findBackupSettingsDocument(ctx, guildId);
    const patch = unwrap(buildStructureBackupLeaseClearPatch(existing ?? undefined, { leaseId: args.leaseId }, now));

    if (!existing || !patch) return false;

    await ctx.db.patch('structureBackupSettings', existing._id, patch);

    return true;
}

export async function claimDueStructureDriftSettingHandler(ctx: StructureMutationCtx, args: LeaseClaimArgs) {
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
}

export async function clearStructureDriftSettingLeaseHandler(ctx: StructureMutationCtx, args: LeaseClearArgs) {
    await requireNeonFluxService(ctx, ['bot']);
    const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
    const now = normalizeTimestamp(args.now);
    if (!now) throw new Error('now-invalid-value');

    const existing = await findBackupSettingsDocument(ctx, guildId);
    const patch = unwrap(buildStructureDriftLeaseClearPatch(existing ?? undefined, { leaseId: args.leaseId }, now));

    if (!existing || !patch) return false;

    await ctx.db.patch('structureBackupSettings', existing._id, patch);

    return true;
}

export async function recordStructureScheduledDriftResultHandler(
    ctx: StructureMutationCtx,
    args: RecordScheduledDriftResultArgs
) {
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
