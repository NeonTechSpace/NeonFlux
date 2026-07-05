import { api } from '@neonflux/convex/api';
import { err, ok, type Result } from 'neverthrow';

import type {
    GuildCommandPermissionRuleRecord,
    GuildCommandPermissionRuleRepositoryError,
    GuildCommandPermissionRuleTargetType,
    GuildDashboardPermissionRuleRecord,
    GuildDashboardPermissionRuleRepositoryError,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

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

type CommandPermissionDb = ConvexDatabase;
type DashboardPermissionDb = ConvexDatabase;

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
    try {
        const rule = await db.client.mutation<ConvexCommandPermissionRuleRecord>(
            convexApi.access_permissions.upsertGuildCommandPermissionRule,
            {
                ...input,
                ...(input.roleIds ? { roleIds: [...input.roleIds] } : {}),
                ...(input.userIds ? { userIds: [...input.userIds] } : {}),
            }
        );

        return ok(toCommandPermissionRuleRecord(rule));
    } catch (error) {
        return err(mapCommandPermissionError(error));
    }
}

export async function findGuildCommandPermissionRule(
    db: CommandPermissionDb,
    input: { guildId: string; targetId: string; targetType: GuildCommandPermissionRuleTargetType }
): Promise<Result<GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleRepositoryError>> {
    try {
        const rule = await db.client.query<ConvexCommandPermissionRuleRecord | null>(
            convexApi.access_permissions.readGuildCommandPermissionRule,
            input
        );

        return rule ? ok(toCommandPermissionRuleRecord(rule)) : err('not-found');
    } catch (error) {
        return err(mapCommandPermissionError(error));
    }
}

export async function listGuildCommandPermissionRulesByGuildId(
    db: CommandPermissionDb,
    input: { guildId: string }
): Promise<Result<GuildCommandPermissionRuleRecord[], GuildCommandPermissionRuleRepositoryError>> {
    try {
        const rules = await db.client.query<ConvexCommandPermissionRuleRecord[]>(
            convexApi.access_permissions.listGuildCommandPermissionRulesByGuildId,
            {
                guildId: input.guildId,
                limit: 1000,
            }
        );

        return ok(rules.map(toCommandPermissionRuleRecord));
    } catch (error) {
        return err(mapCommandPermissionError(error));
    }
}

export async function deleteGuildCommandPermissionRule(
    db: CommandPermissionDb,
    input: { guildId: string; targetId: string; targetType: GuildCommandPermissionRuleTargetType }
): Promise<Result<GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleRepositoryError>> {
    try {
        const rule = await db.client.mutation<ConvexCommandPermissionRuleRecord | null>(
            convexApi.access_permissions.deleteGuildCommandPermissionRule,
            input
        );

        return rule ? ok(toCommandPermissionRuleRecord(rule)) : err('not-found');
    } catch (error) {
        return err(mapCommandPermissionError(error));
    }
}

export async function upsertGuildDashboardPermissionRule(
    db: DashboardPermissionDb,
    input: { guildId: string; roleIds?: readonly string[]; userIds?: readonly string[] }
): Promise<Result<GuildDashboardPermissionRuleRecord, GuildDashboardPermissionRuleRepositoryError>> {
    try {
        const rule = await db.client.mutation<ConvexDashboardPermissionRuleRecord>(
            convexApi.access_permissions.upsertGuildDashboardPermissionRule,
            {
                guildId: input.guildId,
                ...(input.roleIds ? { roleIds: [...input.roleIds] } : {}),
                ...(input.userIds ? { userIds: [...input.userIds] } : {}),
            }
        );

        return ok(toDashboardPermissionRuleRecord(rule));
    } catch (error) {
        return err(mapDashboardPermissionError(error));
    }
}

export async function findGuildDashboardPermissionRule(
    db: DashboardPermissionDb,
    input: { guildId: string }
): Promise<Result<GuildDashboardPermissionRuleRecord, GuildDashboardPermissionRuleRepositoryError>> {
    try {
        const rule = await db.client.query<ConvexDashboardPermissionRuleRecord | null>(
            convexApi.access_permissions.readGuildDashboardPermissionRule,
            input
        );

        return rule ? ok(toDashboardPermissionRuleRecord(rule)) : err('not-found');
    } catch (error) {
        return err(mapDashboardPermissionError(error));
    }
}

export async function listGuildDashboardPermissionRulesByGuildIds(
    db: DashboardPermissionDb,
    input: { guildIds: readonly string[] }
): Promise<Result<GuildDashboardPermissionRuleRecord[], GuildDashboardPermissionRuleRepositoryError>> {
    try {
        const rules = await db.client.query<ConvexDashboardPermissionRuleRecord[]>(
            convexApi.access_permissions.listGuildDashboardPermissionRulesByGuildIds,
            {
                guildIds: [...input.guildIds],
            }
        );

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
