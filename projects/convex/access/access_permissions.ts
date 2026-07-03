import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import {
    buildCommandPermissionRuleDocument,
    buildDashboardPermissionRuleDocument,
    normalizeCommandPermissionLookupInput,
    normalizeGuildIds,
    normalizeRequiredGuildId,
    toCommandPermissionRuleRecord,
    toDashboardPermissionRuleRecord,
    type CommandPermissionRuleDocument,
    type DashboardPermissionRuleDocument,
} from './access_permissions_model.js';
import { requireNeonFluxService } from '../auth.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type AccessQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type AccessMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = {
    _id: GenericId<'guilds'>;
    guildId: string;
};

type StoredCommandPermissionRuleDocument = CommandPermissionRuleDocument & {
    _id: GenericId<'guildCommandPermissionRules'>;
};

type StoredDashboardPermissionRuleDocument = DashboardPermissionRuleDocument & {
    _id: GenericId<'guildDashboardPermissionRules'>;
};

const allowedAccessServices = ['bot', 'web', 'migration'] as const;
const commandRuleListLimit = 1000;

const commandTargetTypeValidator = v.union(v.literal('category'), v.literal('command'));
const commandPermissionRuleRecordValidator = v.object({
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    roleIds: v.array(v.string()),
    targetId: v.string(),
    targetType: commandTargetTypeValidator,
    updatedAt: v.string(),
    userIds: v.array(v.string()),
});
const dashboardPermissionRuleRecordValidator = v.object({
    createdAt: v.string(),
    guildId: v.string(),
    roleIds: v.array(v.string()),
    updatedAt: v.string(),
    userIds: v.array(v.string()),
});
const commandPermissionRuleIdentityArgs = {
    guildId: v.string(),
    targetId: v.string(),
    targetType: commandTargetTypeValidator,
};

export const readGuildCommandPermissionRule = queryGeneric({
    args: commandPermissionRuleIdentityArgs,
    returns: v.union(commandPermissionRuleRecordValidator, v.null()),
    handler: async (ctx: AccessQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAccessServices);
        const lookup = unwrap(normalizeCommandPermissionLookupInput(args));
        const rule = await findCommandPermissionRuleDocument(ctx, lookup);

        return rule ? toCommandPermissionRuleRecord(rule) : null;
    },
});

export const listGuildCommandPermissionRulesByGuildId = queryGeneric({
    args: {
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(commandPermissionRuleRecordValidator),
    handler: async (ctx: AccessQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAccessServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const limit = normalizeRuleListLimit(args.limit);
        const rules = await ctx.db
            .query('guildCommandPermissionRules')
            .withIndex('by_guild_target', (query) => query.eq('guildId', guildId))
            .order('asc')
            .take(limit);

        return rules.map(toCommandPermissionRuleRecord);
    },
});

export const upsertGuildCommandPermissionRule = mutationGeneric({
    args: {
        ...commandPermissionRuleIdentityArgs,
        createdAt: v.optional(v.string()),
        legacyId: v.optional(v.string()),
        roleIds: v.optional(v.array(v.string())),
        updatedAt: v.optional(v.string()),
        userIds: v.optional(v.array(v.string())),
    },
    returns: commandPermissionRuleRecordValidator,
    handler: async (ctx: AccessMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAccessServices);
        const lookup = unwrap(normalizeCommandPermissionLookupInput(args));

        await requireGuildDocument(ctx, lookup.guildId);

        const existingRule = await findCommandPermissionRuleDocument(ctx, lookup);
        const document = unwrap(
            buildCommandPermissionRuleDocument(args, new Date().toISOString(), existingRule ?? undefined, () =>
                crypto.randomUUID()
            )
        );

        if (existingRule) {
            await ctx.db.patch(existingRule._id, {
                roleIds: document.roleIds,
                updatedAt: document.updatedAt,
                userIds: document.userIds,
            });
        } else {
            await ctx.db.insert('guildCommandPermissionRules', document);
        }

        return toCommandPermissionRuleRecord(document);
    },
});

export const deleteGuildCommandPermissionRule = mutationGeneric({
    args: commandPermissionRuleIdentityArgs,
    returns: v.union(commandPermissionRuleRecordValidator, v.null()),
    handler: async (ctx: AccessMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAccessServices);
        const lookup = unwrap(normalizeCommandPermissionLookupInput(args));
        const rule = await findCommandPermissionRuleDocument(ctx, lookup);

        if (!rule) {
            return null;
        }

        await ctx.db.delete(rule._id);

        return toCommandPermissionRuleRecord(rule);
    },
});

export const readGuildDashboardPermissionRule = queryGeneric({
    args: {
        guildId: v.string(),
    },
    returns: v.union(dashboardPermissionRuleRecordValidator, v.null()),
    handler: async (ctx: AccessQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAccessServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const rule = await findDashboardPermissionRuleDocument(ctx, guildId);

        return rule ? toDashboardPermissionRuleRecord(rule) : null;
    },
});

export const listGuildDashboardPermissionRulesByGuildIds = queryGeneric({
    args: {
        guildIds: v.array(v.string()),
    },
    returns: v.array(dashboardPermissionRuleRecordValidator),
    handler: async (ctx: AccessQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAccessServices);
        const guildIds = [...new Set(normalizeGuildIds(args.guildIds))].sort();

        if (guildIds.length === 0) {
            return [];
        }

        const rules = await Promise.all(guildIds.map((guildId) => findDashboardPermissionRuleDocument(ctx, guildId)));

        return rules.flatMap((rule) => (rule ? [toDashboardPermissionRuleRecord(rule)] : []));
    },
});

export const upsertGuildDashboardPermissionRule = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        guildId: v.string(),
        roleIds: v.optional(v.array(v.string())),
        updatedAt: v.optional(v.string()),
        userIds: v.optional(v.array(v.string())),
    },
    returns: dashboardPermissionRuleRecordValidator,
    handler: async (ctx: AccessMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAccessServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingRule = await findDashboardPermissionRuleDocument(ctx, guildId);
        const document = unwrap(
            buildDashboardPermissionRuleDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                existingRule ?? undefined
            )
        );

        if (existingRule) {
            await ctx.db.patch(existingRule._id, {
                roleIds: document.roleIds,
                updatedAt: document.updatedAt,
                userIds: document.userIds,
            });
        } else {
            await ctx.db.insert('guildDashboardPermissionRules', document);
        }

        return toDashboardPermissionRuleRecord(document);
    },
});

async function findCommandPermissionRuleDocument(
    ctx: AccessQueryCtx | AccessMutationCtx,
    input: {
        guildId: string;
        targetId: string;
        targetType: 'category' | 'command';
    }
): Promise<StoredCommandPermissionRuleDocument | null> {
    return await ctx.db
        .query('guildCommandPermissionRules')
        .withIndex('by_guild_target', (query) =>
            query.eq('guildId', input.guildId).eq('targetType', input.targetType).eq('targetId', input.targetId)
        )
        .unique();
}

async function findDashboardPermissionRuleDocument(
    ctx: AccessQueryCtx | AccessMutationCtx,
    guildId: string
): Promise<StoredDashboardPermissionRuleDocument | null> {
    return await ctx.db
        .query('guildDashboardPermissionRules')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();
}

async function requireGuildDocument(ctx: AccessMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function normalizeRuleListLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return commandRuleListLimit;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), commandRuleListLimit);
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: string; ok: false }): Value {
    if (!result.ok) {
        throw new Error(result.error);
    }

    return result.value;
}
