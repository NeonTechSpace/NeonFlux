import type { GenericId } from 'convex/values';

import type { MutationCtx, QueryCtx } from '../_generated/server.js';
import type {
    STRUCTURE_BACKUP_SOURCE,
    STRUCTURE_BACKUP_STATUS,
    StructureBackupDocument,
    StructureBackupSettingsDocument,
    StructureObservedEventStateDocument,
} from './structure_backup_model.js';

export type StructureQueryCtx = QueryCtx;
export type StructureMutationCtx = MutationCtx;
export type StoredBackupDocument = StructureBackupDocument & { _id: GenericId<'structureBackups'> };
export type StoredBackupSettingsDocument = StructureBackupSettingsDocument & {
    _id: GenericId<'structureBackupSettings'>;
};
export type StoredObservedEventDocument = StructureObservedEventStateDocument & {
    _id: GenericId<'guildFeatureSettings'>;
};

export const allowedStructureServices = ['bot', 'web'] as const;
export const restorePointMinimumRecoveryDays = 30;
export const protectedRestorePointRunStatuses = [
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

export async function findObservedEventDocument(
    ctx: StructureQueryCtx | StructureMutationCtx,
    guildId: string
): Promise<StoredObservedEventDocument | null> {
    const row = await ctx.db
        .query('guildFeatureSettings')
        .withIndex('by_guild_feature', (index) => index.eq('guildId', guildId).eq('feature', 'blueprint'))
        .unique();

    return row as StoredObservedEventDocument | null;
}

export async function findBackupById(
    ctx: StructureQueryCtx | StructureMutationCtx,
    backupId: GenericId<'structureBackups'>
): Promise<StoredBackupDocument | null> {
    return await ctx.db.get('structureBackups', backupId);
}

export async function findLatestBackupBySourceAndStatus(
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

export async function findBackupSettingsDocument(
    ctx: StructureQueryCtx | StructureMutationCtx,
    guildId: string
): Promise<StoredBackupSettingsDocument | null> {
    return await ctx.db
        .query('structureBackupSettings')
        .withIndex('by_guild', (index) => index.eq('guildId', guildId))
        .unique();
}

export async function isGuildInEffectiveBotScope(
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

export async function requireGuildDocument(ctx: StructureMutationCtx, guildId: string): Promise<void> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (index) => index.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');
}

export function normalizeBackupSortCursor(value: string | null | undefined): string | undefined {
    const normalized = normalizeOptionalString(value);
    if (!normalized) return undefined;

    const [timestamp, id] = normalized.split('|', 2);
    return normalizeTimestamp(timestamp) && id ? normalized : undefined;
}

export function maxBackupSortKeyForTimestamp(timestamp: string): string {
    return `${timestamp}|\uffff`;
}

export function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseBackupId(backupId: string): GenericId<'structureBackups'> {
    return unwrapRequiredString(backupId, 'backupId') as GenericId<'structureBackups'>;
}

export function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;
        if (typeof error === 'object' && error !== null && 'type' in error) throw new Error(String(error.type));
        throw new Error(String(error));
    }
    return result.value;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function unwrapRequiredString(value: string, field: string): string {
    const normalizedValue = normalizeOptionalString(value);
    if (!normalizedValue) throw new Error(`${field}-missing-input`);
    return normalizedValue;
}
