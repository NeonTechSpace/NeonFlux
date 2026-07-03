import { api } from '@neonflux/convex/api';
import {
    cleanupDeletedGuildRoleReferences as cleanupDeletedGuildRoleReferencesPostgres,
    createRoleReconciliationRun as createRoleReconciliationRunPostgres,
    findRoleReconciliationSettingsByGuildId as findRoleReconciliationSettingsByGuildIdPostgres,
    recordRoleReconciliationAction as recordRoleReconciliationActionPostgres,
    updateRoleReconciliationRunStatus as updateRoleReconciliationRunStatusPostgres,
    upsertRoleReconciliationSettings as upsertRoleReconciliationSettingsPostgres,
    type DeletedGuildRoleReferenceCleanupResult,
    type GuildFeatureRepositoryError,
    type RoleReconciliationActionRecord,
    type RoleReconciliationRepositoryError,
    type RoleReconciliationRunRecord,
    type RoleReconciliationSettingsInput,
    type RoleReconciliationSettingsRecord,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    role_reconciliation: {
        createRoleReconciliationRun: ConvexMutationReference;
        findRoleReconciliationSettingsByGuildId: ConvexQueryReference;
        recordRoleReconciliationAction: ConvexMutationReference;
        updateRoleReconciliationRunStatus: ConvexMutationReference;
        upsertRoleReconciliationSettings: ConvexMutationReference;
    };
    role_reference_cleanup: {
        cleanupDeletedGuildRoleReferences: ConvexMutationReference;
    };
};

type PostgresRoleReconciliationDb = Parameters<typeof findRoleReconciliationSettingsByGuildIdPostgres>[0];
type RoleReconciliationDb = ConvexPersistenceDatabase | PostgresRoleReconciliationDb;

type ConvexRoleReconciliationSettingsRecord = {
    cleanupDeletedRoleReferences: boolean;
    createdAt?: string;
    enabled: boolean;
    guildId: string;
    restoreAutoroleRoles: boolean;
    restoreReactionRoles: boolean;
    restoreVerificationRoles: boolean;
    updatedAt?: string;
};

type ConvexRoleReconciliationRunRecord = {
    createdAt: string;
    guildId: string;
    id: string;
    status: string;
    summary: Record<string, unknown>;
    updatedAt: string;
};

type ConvexRoleReconciliationActionRecord = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    id: string;
    roleId: string | null;
    runId: string;
    status: string;
    updatedAt: string;
};

export async function findRoleReconciliationSettingsByGuildId(
    db: RoleReconciliationDb,
    input: { guildId: string }
): Promise<Result<RoleReconciliationSettingsRecord, RoleReconciliationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return findRoleReconciliationSettingsByGuildIdPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const settings = (await db.client.query(convexApi.role_reconciliation.findRoleReconciliationSettingsByGuildId, {
            guildId: guildId.value,
        })) as ConvexRoleReconciliationSettingsRecord;

        return ok(toRoleReconciliationSettingsRecord(settings));
    } catch (error) {
        return err(mapConvexRoleReconciliationError(error));
    }
}

export async function upsertRoleReconciliationSettings(
    db: RoleReconciliationDb,
    input: RoleReconciliationSettingsInput
): Promise<Result<RoleReconciliationSettingsRecord, RoleReconciliationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return upsertRoleReconciliationSettingsPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const settings = (await db.client.mutation(convexApi.role_reconciliation.upsertRoleReconciliationSettings, {
            ...(input.cleanupDeletedRoleReferences === undefined
                ? {}
                : { cleanupDeletedRoleReferences: input.cleanupDeletedRoleReferences }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            guildId: guildId.value,
            ...(input.restoreAutoroleRoles === undefined ? {} : { restoreAutoroleRoles: input.restoreAutoroleRoles }),
            ...(input.restoreReactionRoles === undefined ? {} : { restoreReactionRoles: input.restoreReactionRoles }),
            ...(input.restoreVerificationRoles === undefined
                ? {}
                : { restoreVerificationRoles: input.restoreVerificationRoles }),
        })) as ConvexRoleReconciliationSettingsRecord;

        return ok(toRoleReconciliationSettingsRecord(settings));
    } catch (error) {
        return err(mapConvexRoleReconciliationError(error));
    }
}

export async function createRoleReconciliationRun(
    db: RoleReconciliationDb,
    input: { guildId: string; summary?: Record<string, unknown> }
): Promise<Result<RoleReconciliationRunRecord, RoleReconciliationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return createRoleReconciliationRunPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const summary = normalizeOptionalRecord(input.summary, 'summary');

    if (guildId.isErr()) return err(guildId.error);
    if (summary.isErr()) return err(summary.error);

    try {
        const run = (await db.client.mutation(convexApi.role_reconciliation.createRoleReconciliationRun, {
            guildId: guildId.value,
            ...(summary.value === undefined ? {} : { summary: summary.value }),
        })) as ConvexRoleReconciliationRunRecord;

        return ok(toRoleReconciliationRunRecord(run));
    } catch (error) {
        return err(mapConvexRoleReconciliationError(error));
    }
}

export async function updateRoleReconciliationRunStatus(
    db: RoleReconciliationDb,
    input: { runId: string; status: string; summary?: Record<string, unknown> }
): Promise<Result<RoleReconciliationRunRecord, RoleReconciliationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return updateRoleReconciliationRunStatusPostgres(db, input);
    }

    const runId = normalizeRequiredText(input.runId, 'runId');
    const status = normalizeRequiredText(input.status, 'status');
    const summary = normalizeOptionalRecord(input.summary, 'summary');

    if (runId.isErr()) return err(runId.error);
    if (status.isErr()) return err(status.error);
    if (summary.isErr()) return err(summary.error);

    try {
        const run = (await db.client.mutation(convexApi.role_reconciliation.updateRoleReconciliationRunStatus, {
            runId: runId.value,
            status: status.value,
            ...(summary.value === undefined ? {} : { summary: summary.value }),
        })) as ConvexRoleReconciliationRunRecord | null;

        return run ? ok(toRoleReconciliationRunRecord(run)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapConvexRoleReconciliationError(error));
    }
}

export async function recordRoleReconciliationAction(
    db: RoleReconciliationDb,
    input: {
        actionType: string;
        details?: Record<string, unknown>;
        roleId?: string;
        runId: string;
        status?: string;
    }
): Promise<Result<RoleReconciliationActionRecord, RoleReconciliationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return recordRoleReconciliationActionPostgres(db, input);
    }

    const runId = normalizeRequiredText(input.runId, 'runId');
    const actionType = normalizeRequiredText(input.actionType, 'actionType');
    const roleId = input.roleId ? normalizeRequiredText(input.roleId, 'roleId') : ok(undefined);
    const status = input.status ? normalizeRequiredText(input.status, 'status') : ok(undefined);
    const details = normalizeOptionalRecord(input.details, 'details');

    if (runId.isErr()) return err(runId.error);
    if (actionType.isErr()) return err(actionType.error);
    if (roleId.isErr()) return err(roleId.error);
    if (status.isErr()) return err(status.error);
    if (details.isErr()) return err(details.error);

    try {
        const action = (await db.client.mutation(convexApi.role_reconciliation.recordRoleReconciliationAction, {
            actionType: actionType.value,
            ...(details.value === undefined ? {} : { details: details.value }),
            ...(roleId.value === undefined ? {} : { roleId: roleId.value }),
            runId: runId.value,
            ...(status.value === undefined ? {} : { status: status.value }),
        })) as ConvexRoleReconciliationActionRecord;

        return ok(toRoleReconciliationActionRecord(action));
    } catch (error) {
        return err(mapConvexRoleReconciliationError(error));
    }
}

export async function cleanupDeletedGuildRoleReferences(
    db: RoleReconciliationDb,
    input: { guildId: string; occurredAt?: Date; roleId: string }
): Promise<Result<DeletedGuildRoleReferenceCleanupResult, RoleReconciliationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return cleanupDeletedGuildRoleReferencesPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');
    const occurredAt = input.occurredAt ? normalizeDate(input.occurredAt, 'occurredAt') : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (roleId.isErr()) return err(roleId.error);
    if (occurredAt.isErr()) return err(occurredAt.error);

    try {
        const result = (await db.client.mutation(convexApi.role_reference_cleanup.cleanupDeletedGuildRoleReferences, {
            guildId: guildId.value,
            ...(occurredAt.value === undefined ? {} : { occurredAt: occurredAt.value }),
            roleId: roleId.value,
        })) as DeletedGuildRoleReferenceCleanupResult;

        return ok(result);
    } catch (error) {
        return err(mapConvexRoleReconciliationError(error));
    }
}

function toRoleReconciliationSettingsRecord(
    record: ConvexRoleReconciliationSettingsRecord
): RoleReconciliationSettingsRecord {
    return {
        cleanupDeletedRoleReferences: record.cleanupDeletedRoleReferences,
        ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
        enabled: record.enabled,
        guildId: record.guildId,
        restoreAutoroleRoles: record.restoreAutoroleRoles,
        restoreReactionRoles: record.restoreReactionRoles,
        restoreVerificationRoles: record.restoreVerificationRoles,
        ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt) } : {}),
    };
}

function toRoleReconciliationRunRecord(record: ConvexRoleReconciliationRunRecord): RoleReconciliationRunRecord {
    return {
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        id: record.id,
        status: record.status,
        summary: record.summary,
        updatedAt: new Date(record.updatedAt),
    };
}

function toRoleReconciliationActionRecord(
    record: ConvexRoleReconciliationActionRecord
): RoleReconciliationActionRecord {
    return {
        actionType: record.actionType,
        createdAt: new Date(record.createdAt),
        details: record.details,
        id: record.id,
        roleId: record.roleId,
        runId: record.runId,
        status: record.status,
        updatedAt: new Date(record.updatedAt),
    };
}

function mapConvexRoleReconciliationError(error: unknown): RoleReconciliationRepositoryError {
    const message = error instanceof Error ? error.message.trim() : '';

    return message === 'not-found' || message.endsWith(': not-found')
        ? { type: 'not-found' }
        : { type: 'database-error' };
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

function normalizeOptionalRecord(
    value: Record<string, unknown> | undefined,
    field: string
): Result<Record<string, unknown> | undefined, GuildFeatureRepositoryError> {
    if (value === undefined || isRecord(value)) {
        return ok(value);
    }

    return err({ field, type: 'invalid-value' });
}

function normalizeDate(value: Date, field: string): Result<string, GuildFeatureRepositoryError> {
    const timestamp = value.getTime();

    return Number.isFinite(timestamp) ? ok(value.toISOString()) : err({ field, type: 'invalid-value' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
