import { requireNeonFluxService } from '../auth.js';
import {
    allowedStructureServices,
    findBackupById,
    findBackupSettingsDocument,
    normalizeTimestamp,
    parseBackupId,
    protectedRestorePointRunStatuses,
    requireGuildDocument,
    restorePointMinimumRecoveryDays,
    type StructureMutationCtx,
    unwrap,
} from './blueprint_backup_access.js';
import type { CreateBackupArgs, DeleteBackupArgs, RenameBackupArgs } from './blueprint_backup_contract.js';
import { recordBlueprintAuditInMutation } from './blueprint_audit.js';
import {
    addDays,
    buildBackupSortCursor,
    buildStructureBackupAttemptPatch,
    buildStructureBackupDocument,
    buildStructureBackupSettingsDocument,
    normalizeBackupName,
    normalizeRequiredGuildId,
    STRUCTURE_BACKUP_SOURCE,
    type STRUCTURE_BACKUP_STATUS,
    toStructureBackupRecord,
    toStructureBackupSummaryRecord,
    type StructureBackupSettingsDocument,
} from './structure_backup_model.js';

export async function createStructureBackupHandler(ctx: StructureMutationCtx, args: CreateBackupArgs) {
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
}

export async function renameStructureBackupHandler(ctx: StructureMutationCtx, args: RenameBackupArgs) {
    await requireNeonFluxService(ctx, ['web']);
    const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
    const backup = await findBackupById(ctx, parseBackupId(args.backupId));
    if (backup?.guildId !== guildId) return null;

    const name = normalizeBackupName(args.name, backup.name);
    await ctx.db.patch('structureBackups', backup._id, { name });
    await recordBlueprintAuditInMutation(ctx, guildId, args.audit, new Date().toISOString(), backup._id);

    return toStructureBackupSummaryRecord({ ...backup, name });
}

export async function deleteStructureBackupHandler(ctx: StructureMutationCtx, args: DeleteBackupArgs) {
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
}

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
