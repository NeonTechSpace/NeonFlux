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
import { deleteStructureBackupArtifactChunks } from './blueprint_artifact_persistence.js';
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
        await recordBlueprintAuditInMutation(ctx, guildId, args.audit, now, guildId);
        return toStructureBackupSettingsRecord(applyKnownPatch(existing, patch), guildId);
    }

    const document = unwrap(buildStructureBackupSettingsDocument({ ...args, guildId }, now));
    await ctx.db.insert('structureBackupSettings', document);
    await recordBlueprintAuditInMutation(ctx, guildId, args.audit, now, guildId);

    return toStructureBackupSettingsRecord(document, guildId);
}

export async function listDueStructureBackupSettingsHandler(ctx: StructureQueryCtx, args: DueSettingsArgs) {
    await requireNeonFluxService(ctx, allowedStructureServices);
    return await listDueSettingsPage(ctx, args, 'backup');
}

export async function listDueStructureDriftSettingsHandler(ctx: StructureQueryCtx, args: DueSettingsArgs) {
    await requireNeonFluxService(ctx, ['bot']);
    return await listDueSettingsPage(ctx, args, 'drift');
}

export async function listDueStructureBackupRetentionSettingsHandler(ctx: StructureQueryCtx, args: DueSettingsArgs) {
    await requireNeonFluxService(ctx, ['bot']);
    return await listDueSettingsPage(ctx, args, 'retention');
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

    const limit = Math.min(normalizeLimit(args.limit, 25), 25);
    const retentionDays = normalizeBackupRetentionDays(settings.retentionDays);
    const cutoff =
        normalizeTimestamp(settings.retentionCutoff) ??
        new Date(Date.parse(now) - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const cursor = settings.retentionCursor;
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
    const cutoffCursor = maxBackupSortKeyForTimestamp(cutoff);
    const expiredQuery = cursor
        ? ctx.db
              .query('structureBackups')
              .withIndex('by_guild_sort_key', (index) =>
                  index.eq('guildId', guildId).gt('sortKey', cursor).lt('sortKey', cutoffCursor)
              )
        : ctx.db
              .query('structureBackups')
              .withIndex('by_guild_sort_key', (index) => index.eq('guildId', guildId).lt('sortKey', cutoffCursor));
    const expiredBackups = await expiredQuery.order('asc').take(26);
    const candidates = expiredBackups.slice(0, 25);
    const maximumArtifactBytes = 4 * 1024 * 1024;
    let deletedArtifactBytes = 0;
    let deletedCount = 0;
    let retentionCursor = cursor;
    let stoppedForByteLimit = false;
    for (const backup of candidates) {
        const eligible = isStructureBackupRetentionEligible(
            { createdAt: backup.createdAt, id: String(backup._id), source: backup.source },
            { protectedRestorePointIds, restorePointCutoff }
        );
        const artifactBytes = backup.artifactBytes ?? 0;
        if (
            eligible &&
            deletedCount > 0 &&
            (deletedCount >= limit || deletedArtifactBytes + artifactBytes > maximumArtifactBytes)
        ) {
            stoppedForByteLimit = true;
            break;
        }
        retentionCursor = backup.sortKey;
        if (!eligible) continue;
        await deleteStructureBackupArtifactChunks(ctx, backup._id);
        await ctx.db.delete('structureBackups', backup._id);
        deletedCount += 1;
        deletedArtifactBytes += artifactBytes;
    }

    const hasMore = stoppedForByteLimit || expiredBackups.length > candidates.length;
    const nextRetentionPruneAt = hasMore ? now : addDays(now, 1);
    await ctx.db.patch('structureBackupSettings', settings._id, {
        nextRetentionPruneAt,
        retentionCutoff: hasMore ? cutoff : undefined,
        retentionCursor: hasMore ? retentionCursor : undefined,
        retentionDays,
        updatedAt: now,
    });
    if (deletedCount > 0) {
        await recordBlueprintAuditInMutation(
            ctx,
            guildId,
            args.audit
                ? {
                      ...args.audit,
                      metadata: {
                          ...(isObjectRecord(args.audit.metadata) ? args.audit.metadata : {}),
                          deletedArtifactBytes,
                          deletedCount,
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

    return { deletedCount, hasMore, nextRetentionPruneAt };
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
    return toStructureBackupSettingsRecord(applyKnownPatch(existing, patch), guildId);
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
    return toStructureBackupSettingsRecord(applyKnownPatch(existing, patch), guildId);
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
    return toStructureBackupSettingsRecord(applyKnownPatch(existing, patch), guildId);
}

type DueSettingsKind = 'backup' | 'drift' | 'retention';

async function listDueSettingsPage(ctx: StructureQueryCtx, args: DueSettingsArgs, kind: DueSettingsKind) {
    const now = normalizeTimestamp(args.now);
    if (!now) return { nextCursor: null, settings: [] };
    const pageSize = Math.min(normalizeLimit(args.limit, 25), 25);
    const deploymentConfig = await ctx.db.query('deploymentConfig').withIndex('by_config_id').unique();
    if (!deploymentConfig) return { nextCursor: null, settings: [] };

    if (deploymentConfig.instanceMode === 'single') {
        const guildId = deploymentConfig.singleGuildId;
        if (!guildId || args.cursor) return { nextCursor: null, settings: [] };
        const setting = await findBackupSettingsDocument(ctx, guildId);
        if (!setting || !isDueSetting(setting, kind, now) || !(await hasActiveInstallation(ctx, guildId))) {
            return { nextCursor: null, settings: [] };
        }
        return { nextCursor: null, settings: [toStructureBackupSettingsRecord(setting, guildId)] };
    }

    const pagination = { cursor: args.cursor ?? null, numItems: pageSize };
    const page =
        kind === 'backup'
            ? await ctx.db
                  .query('structureBackupSettings')
                  .withIndex('by_enabled_next_backup', (index) => index.eq('enabled', true).lte('nextBackupAt', now))
                  .paginate(pagination)
            : kind === 'drift'
              ? await ctx.db
                    .query('structureBackupSettings')
                    .withIndex('by_enabled_next_drift_check', (index) =>
                        index.eq('enabled', true).lte('nextDriftCheckAt', now)
                    )
                    .paginate(pagination)
              : await ctx.db
                    .query('structureBackupSettings')
                    .withIndex('by_next_retention_prune', (index) => index.lte('nextRetentionPruneAt', now))
                    .paginate(pagination);
    const eligible = await Promise.all(
        page.page.map(async (setting) => ({
            eligible: isDueSetting(setting, kind, now) && (await hasActiveInstallation(ctx, setting.guildId)),
            setting,
        }))
    );
    return {
        nextCursor: page.isDone ? null : page.continueCursor,
        settings: eligible
            .filter(({ eligible: isEligible }) => isEligible)
            .map(({ setting }) => toStructureBackupSettingsRecord(setting, setting.guildId)),
    };
}

async function hasActiveInstallation(ctx: StructureQueryCtx, guildId: string): Promise<boolean> {
    return Boolean(
        await ctx.db
            .query('botInstallations')
            .withIndex('by_guild_id', (index) => index.eq('guildId', guildId))
            .unique()
    );
}

function isDueSetting(setting: StructureBackupSettingsDocument, kind: DueSettingsKind, now: string): boolean {
    switch (kind) {
        case 'backup':
            return setting.enabled && isTimestampDue(setting.nextBackupAt, now) && !hasActiveBackupLease(setting, now);
        case 'drift':
            return isDriftDue(setting, now) && !hasActiveDriftLease(setting, now);
        case 'retention':
            return isTimestampDue(setting.nextRetentionPruneAt, now);
    }
}

function applyKnownPatch<T extends object>(document: T, patch: Partial<Record<keyof T, unknown>>): T {
    const updated = new Map(Object.entries(document));
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) updated.delete(key);
        else updated.set(key, value);
    }
    return Object.fromEntries(updated) as T;
}

function isTimestampDue(value: string | undefined, now: string): boolean {
    const timestamp = Date.parse(value ?? '');
    const parsedNow = Date.parse(now);
    return Number.isFinite(timestamp) && Number.isFinite(parsedNow) && timestamp <= parsedNow;
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
