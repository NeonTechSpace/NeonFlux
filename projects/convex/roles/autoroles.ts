import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import {
    buildAutoroleRuleDocument,
    normalizeAutoroleRuleLimit,
    normalizeAutoroleRuleLookupInput,
    normalizeRequiredGuildId,
    toAutoroleRuleRecord,
    type AutoroleRuleDocument,
} from './autoroles_model.js';
import { requireNeonFluxService } from '../auth.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type AutoroleQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type AutoroleMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = {
    _id: GenericId<'guilds'>;
    guildId: string;
};

type StoredAutoroleRuleDocument = AutoroleRuleDocument & {
    _id: GenericId<'autoroleRules'>;
};

const allowedAutoroleServices = ['bot', 'web', 'migration'] as const;
const autoroleRuleRecordValidator = v.object({
    createdAt: v.string(),
    enabled: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    name: v.union(v.string(), v.null()),
    roleId: v.string(),
    updatedAt: v.string(),
});
const autoroleRuleIdentityArgs = {
    guildId: v.string(),
    roleId: v.string(),
};

export const readAutoroleRule = queryGeneric({
    args: autoroleRuleIdentityArgs,
    returns: v.union(autoroleRuleRecordValidator, v.null()),
    handler: async (ctx: AutoroleQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutoroleServices);
        const lookup = unwrap(normalizeAutoroleRuleLookupInput(args));
        const rule = await findAutoroleRuleDocument(ctx, lookup);

        return rule ? toAutoroleRuleRecord(rule) : null;
    },
});

export const listAutoroleRulesByGuildId = queryGeneric({
    args: {
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(autoroleRuleRecordValidator),
    handler: async (ctx: AutoroleQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutoroleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const rules = await ctx.db
            .query('autoroleRules')
            .withIndex('by_guild_role', (query) => query.eq('guildId', guildId))
            .order('asc')
            .take(normalizeAutoroleRuleLimit(args.limit));

        return rules.map(toAutoroleRuleRecord);
    },
});

export const listEnabledAutoroleRulesByGuildId = queryGeneric({
    args: {
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(autoroleRuleRecordValidator),
    handler: async (ctx: AutoroleQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutoroleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const rules = await ctx.db
            .query('autoroleRules')
            .withIndex('by_guild_enabled_role', (query) => query.eq('guildId', guildId).eq('enabled', true))
            .order('asc')
            .take(normalizeAutoroleRuleLimit(args.limit));

        return rules.map(toAutoroleRuleRecord);
    },
});

export const upsertAutoroleRule = mutationGeneric({
    args: {
        ...autoroleRuleIdentityArgs,
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        legacyId: v.optional(v.string()),
        name: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: autoroleRuleRecordValidator,
    handler: async (ctx: AutoroleMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutoroleServices);
        const lookup = unwrap(normalizeAutoroleRuleLookupInput(args));

        await requireGuildDocument(ctx, lookup.guildId);

        const existingRule = await findAutoroleRuleDocument(ctx, lookup);
        const document = unwrap(
            buildAutoroleRuleDocument(
                {
                    ...args,
                    ...lookup,
                },
                new Date().toISOString(),
                existingRule ?? undefined,
                () => crypto.randomUUID()
            )
        );

        if (existingRule) {
            await ctx.db.patch(existingRule._id, {
                enabled: document.enabled,
                name: document.name,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('autoroleRules', document);
        }

        return toAutoroleRuleRecord(document);
    },
});

export const deleteAutoroleRule = mutationGeneric({
    args: autoroleRuleIdentityArgs,
    returns: v.union(autoroleRuleRecordValidator, v.null()),
    handler: async (ctx: AutoroleMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutoroleServices);
        const lookup = unwrap(normalizeAutoroleRuleLookupInput(args));
        const rule = await findAutoroleRuleDocument(ctx, lookup);

        if (!rule) {
            return null;
        }

        await ctx.db.delete(rule._id);

        return toAutoroleRuleRecord(rule);
    },
});

async function findAutoroleRuleDocument(
    ctx: AutoroleQueryCtx | AutoroleMutationCtx,
    input: {
        guildId: string;
        roleId: string;
    }
): Promise<StoredAutoroleRuleDocument | null> {
    return await ctx.db
        .query('autoroleRules')
        .withIndex('by_guild_role', (query) => query.eq('guildId', input.guildId).eq('roleId', input.roleId))
        .unique();
}

async function requireGuildDocument(ctx: AutoroleMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;

        if (typeof error === 'object' && error !== null && 'type' in error) {
            throw new Error(String(error.type));
        }

        throw new Error(String(error));
    }

    return result.value;
}
