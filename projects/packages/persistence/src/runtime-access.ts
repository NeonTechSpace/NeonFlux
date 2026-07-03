import { api } from '@neonflux/convex/api';
import {
    deleteGuildCommandPermissionRule as deleteGuildCommandPermissionRulePostgres,
    findGuildCommandPermissionRule as findGuildCommandPermissionRulePostgres,
    findGuildDashboardPermissionRule as findGuildDashboardPermissionRulePostgres,
    listGuildCommandPermissionRulesByGuildId as listGuildCommandPermissionRulesByGuildIdPostgres,
    listGuildDashboardPermissionRulesByGuildIds as listGuildDashboardPermissionRulesByGuildIdsPostgres,
    upsertGuildCommandPermissionRule as upsertGuildCommandPermissionRulePostgres,
    upsertGuildDashboardPermissionRule as upsertGuildDashboardPermissionRulePostgres,
    type GuildCommandPermissionRuleRecord,
    type GuildCommandPermissionRuleRepositoryError,
    type GuildCommandPermissionRuleTargetType,
    type GuildDashboardPermissionRuleRecord,
    type GuildDashboardPermissionRuleRepositoryError,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    access_permissions: {
        deleteGuildCommandPermissionRule: ConvexMutationReference;
        listGuildCommandPermissionRulesByGuildId: ConvexQueryReference;
        listGuildDashboardPermissionRulesByGuildIds: ConvexQueryReference;
        readGuildCommandPermissionRule: ConvexQueryReference;
        readGuildDashboardPermissionRule: ConvexQueryReference;
        upsertGuildCommandPermissionRule: ConvexMutationReference;
        upsertGuildDashboardPermissionRule: ConvexMutationReference;
    };
};

type PostgresCommandPermissionDb = Parameters<typeof upsertGuildCommandPermissionRulePostgres>[0];
type PostgresDashboardPermissionDb = Parameters<typeof upsertGuildDashboardPermissionRulePostgres>[0];

type CommandPermissionDb = ConvexPersistenceDatabase | PostgresCommandPermissionDb;
type DashboardPermissionDb = ConvexPersistenceDatabase | PostgresDashboardPermissionDb;

type ConvexCommandPermissionRuleRecord = {
    createdAt: string;
    guildId: string;
    id: string;
    roleIds: string[];
    targetId: string;
    targetType: GuildCommandPermissionRuleTargetType;
    updatedAt: string;
    userIds: string[];
};

type ConvexDashboardPermissionRuleRecord = {
    createdAt: string;
    guildId: string;
    roleIds: string[];
    updatedAt: string;
    userIds: string[];
};

export async function upsertGuildCommandPermissionRule(
    db: CommandPermissionDb,
    input: {
        guildId: string;
        roleIds?: readonly string[];
        targetId: string;
        targetType: GuildCommandPermissionRuleTargetType;
        userIds?: readonly string[];
    }
): Promise<Result<GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return upsertGuildCommandPermissionRulePostgres(db, input);
    }

    try {
        const rule = (await db.client.mutation(convexApi.access_permissions.upsertGuildCommandPermissionRule, {
            ...input,
            ...(input.roleIds ? { roleIds: [...input.roleIds] } : {}),
            ...(input.userIds ? { userIds: [...input.userIds] } : {}),
        })) as ConvexCommandPermissionRuleRecord;

        return ok(toCommandPermissionRuleRecord(rule));
    } catch (error) {
        return err(mapCommandPermissionError(error));
    }
}

export async function findGuildCommandPermissionRule(
    db: CommandPermissionDb,
    input: { guildId: string; targetId: string; targetType: GuildCommandPermissionRuleTargetType }
): Promise<Result<GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return findGuildCommandPermissionRulePostgres(db, input);
    }

    try {
        const rule = (await db.client.query(
            convexApi.access_permissions.readGuildCommandPermissionRule,
            input
        )) as ConvexCommandPermissionRuleRecord | null;

        return rule ? ok(toCommandPermissionRuleRecord(rule)) : err('not-found');
    } catch (error) {
        return err(mapCommandPermissionError(error));
    }
}

export async function listGuildCommandPermissionRulesByGuildId(
    db: CommandPermissionDb,
    input: { guildId: string }
): Promise<Result<GuildCommandPermissionRuleRecord[], GuildCommandPermissionRuleRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return listGuildCommandPermissionRulesByGuildIdPostgres(db, input);
    }

    try {
        const rules = (await db.client.query(convexApi.access_permissions.listGuildCommandPermissionRulesByGuildId, {
            guildId: input.guildId,
            limit: 1000,
        })) as ConvexCommandPermissionRuleRecord[];

        return ok(rules.map(toCommandPermissionRuleRecord));
    } catch (error) {
        return err(mapCommandPermissionError(error));
    }
}

export async function deleteGuildCommandPermissionRule(
    db: CommandPermissionDb,
    input: { guildId: string; targetId: string; targetType: GuildCommandPermissionRuleTargetType }
): Promise<Result<GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return deleteGuildCommandPermissionRulePostgres(db, input);
    }

    try {
        const rule = (await db.client.mutation(
            convexApi.access_permissions.deleteGuildCommandPermissionRule,
            input
        )) as ConvexCommandPermissionRuleRecord | null;

        return rule ? ok(toCommandPermissionRuleRecord(rule)) : err('not-found');
    } catch (error) {
        return err(mapCommandPermissionError(error));
    }
}

export async function upsertGuildDashboardPermissionRule(
    db: DashboardPermissionDb,
    input: { guildId: string; roleIds?: readonly string[]; userIds?: readonly string[] }
): Promise<Result<GuildDashboardPermissionRuleRecord, GuildDashboardPermissionRuleRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return upsertGuildDashboardPermissionRulePostgres(db, input);
    }

    try {
        const rule = (await db.client.mutation(convexApi.access_permissions.upsertGuildDashboardPermissionRule, {
            guildId: input.guildId,
            ...(input.roleIds ? { roleIds: [...input.roleIds] } : {}),
            ...(input.userIds ? { userIds: [...input.userIds] } : {}),
        })) as ConvexDashboardPermissionRuleRecord;

        return ok(toDashboardPermissionRuleRecord(rule));
    } catch (error) {
        return err(mapDashboardPermissionError(error));
    }
}

export async function findGuildDashboardPermissionRule(
    db: DashboardPermissionDb,
    input: { guildId: string }
): Promise<Result<GuildDashboardPermissionRuleRecord, GuildDashboardPermissionRuleRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return findGuildDashboardPermissionRulePostgres(db, input);
    }

    try {
        const rule = (await db.client.query(
            convexApi.access_permissions.readGuildDashboardPermissionRule,
            input
        )) as ConvexDashboardPermissionRuleRecord | null;

        return rule ? ok(toDashboardPermissionRuleRecord(rule)) : err('not-found');
    } catch (error) {
        return err(mapDashboardPermissionError(error));
    }
}

export async function listGuildDashboardPermissionRulesByGuildIds(
    db: DashboardPermissionDb,
    input: { guildIds: readonly string[] }
): Promise<Result<GuildDashboardPermissionRuleRecord[], GuildDashboardPermissionRuleRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return listGuildDashboardPermissionRulesByGuildIdsPostgres(db, input);
    }

    try {
        const rules = (await db.client.query(convexApi.access_permissions.listGuildDashboardPermissionRulesByGuildIds, {
            guildIds: [...input.guildIds],
        })) as ConvexDashboardPermissionRuleRecord[];

        return ok(rules.map(toDashboardPermissionRuleRecord));
    } catch (error) {
        return err(mapDashboardPermissionError(error));
    }
}

function toCommandPermissionRuleRecord(record: ConvexCommandPermissionRuleRecord): GuildCommandPermissionRuleRecord {
    return {
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        roleIds: record.roleIds,
        targetId: record.targetId,
        targetType: record.targetType,
        updatedAt: new Date(record.updatedAt),
        userIds: record.userIds,
    };
}

function toDashboardPermissionRuleRecord(
    record: ConvexDashboardPermissionRuleRecord
): GuildDashboardPermissionRuleRecord {
    return {
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        roleIds: record.roleIds,
        updatedAt: new Date(record.updatedAt),
        userIds: record.userIds,
    };
}

function mapCommandPermissionError(error: unknown): GuildCommandPermissionRuleRepositoryError {
    if (!(error instanceof Error)) {
        return 'database-error';
    }

    if (error.message.includes('missing-guild-id')) return 'missing-guild-id';
    if (error.message.includes('invalid-target-type')) return 'invalid-target-type';
    if (error.message.includes('missing-target-id')) return 'missing-target-id';

    return 'database-error';
}

function mapDashboardPermissionError(error: unknown): GuildDashboardPermissionRuleRepositoryError {
    return error instanceof Error && error.message.includes('missing-guild-id') ? 'missing-guild-id' : 'database-error';
}
