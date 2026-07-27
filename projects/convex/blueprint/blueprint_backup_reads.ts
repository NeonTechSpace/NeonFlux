import { requireNeonFluxService } from '../auth.js';
import { loadStructureBackupArtifact } from './blueprint_artifact_persistence.js';
import {
    allowedStructureServices,
    findBackupById,
    findLatestBackupBySourceAndStatus,
    findObservedEventDocument,
    normalizeBackupSortCursor,
    parseBackupId,
    requireGuildDocument,
    type StoredBackupDocument,
    type StructureMutationCtx,
    type StructureQueryCtx,
    unwrap,
} from './blueprint_backup_access.js';
import type {
    FindBackupArgs,
    GuildIdArgs,
    ListBackupSummaryPageArgs,
    RecordObservedEventArgs,
} from './blueprint_backup_contract.js';
import {
    buildObservedEventStateDocument,
    chooseLatestStructureDriftBaselineBackup,
    normalizeLimit,
    normalizeRequiredGuildId,
    STRUCTURE_BACKUP_SOURCE,
    STRUCTURE_BACKUP_STATUS,
    toStructureBackupRecord,
    toStructureBackupSummaryRecord,
    toStructureObservedEventStateRecord,
} from './structure_backup_model.js';

export async function findStructureObservedEventStateByGuildIdHandler(ctx: StructureQueryCtx, args: GuildIdArgs) {
    await requireNeonFluxService(ctx, allowedStructureServices);
    const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
    const state = await findObservedEventDocument(ctx, guildId);

    return state
        ? toStructureObservedEventStateRecord(state)
        : { guildId, observedChangeCount: 0, targetChangeCounts: {} };
}

export async function recordStructureObservedEventHandler(ctx: StructureMutationCtx, args: RecordObservedEventArgs) {
    await requireNeonFluxService(ctx, allowedStructureServices);
    const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

    await requireGuildDocument(ctx, guildId);

    const existing = await findObservedEventDocument(ctx, guildId);
    const current = existing
        ? toStructureObservedEventStateRecord(existing)
        : { guildId, observedChangeCount: 0, targetChangeCounts: {} };
    const document = unwrap(
        buildObservedEventStateDocument({ ...args, guildId }, current, new Date().toISOString(), existing ?? undefined)
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
}

export async function listStructureBackupSummaryPageByGuildIdHandler(
    ctx: StructureQueryCtx,
    args: ListBackupSummaryPageArgs
) {
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
}

export async function findStructureBackupByGuildIdHandler(ctx: StructureQueryCtx, args: FindBackupArgs) {
    await requireNeonFluxService(ctx, allowedStructureServices);
    const backup = await findBackupById(ctx, parseBackupId(args.backupId));

    if (backup?.guildId !== args.guildId) return null;
    const structure =
        backup.status === STRUCTURE_BACKUP_STATUS.succeeded ? await loadStructureBackupArtifact(ctx, backup) : null;
    return toStructureBackupRecord(backup, structure);
}

export async function findLatestStructureDriftBaselineBackupByGuildIdHandler(
    ctx: StructureQueryCtx,
    args: GuildIdArgs
) {
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

    if (!latest) return null;
    return toStructureBackupRecord(latest, await loadStructureBackupArtifact(ctx, latest));
}
