import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildGuildDefconExemptionDocument,
    buildGuildSecurityPolicyDocument,
    normalizeDefconExemptionLookupInput,
    normalizeGuildIds,
    normalizeRequiredGuildId,
    toGuildDefconExemptionRecord,
    toGuildSecurityPolicyRecord,
    type GuildDefconExemptionDocument,
    type GuildSecurityPolicyDocument,
} from './security_policies_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type SecurityPolicyQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type SecurityPolicyMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = {
    _id: GenericId<'guilds'>;
    guildId: string;
};

type StoredGuildSecurityPolicyDocument = GuildSecurityPolicyDocument & {
    _id: GenericId<'guildSecurityPolicies'>;
};

type StoredGuildDefconExemptionDocument = GuildDefconExemptionDocument & {
    _id: GenericId<'guildDefconExemptions'>;
};

const allowedSecurityPolicyServices = ['bot', 'web'] as const;
const defconExemptionCategoryLimit = 500;

const defconLevelValidator = v.union(v.literal(1), v.literal(2), v.literal(3));
const guildSecurityPolicyRecordValidator = v.object({
    createdAt: v.string(),
    defconLevel: defconLevelValidator,
    guildId: v.string(),
    updatedAt: v.string(),
});
const guildDefconExemptionRecordValidator = v.object({
    category: v.string(),
    createdAt: v.string(),
    guildId: v.string(),
});
const guildDefconExemptionIdentityArgs = {
    category: v.string(),
    guildId: v.string(),
};

export const readGuildSecurityPolicy = queryGeneric({
    args: {
        guildId: v.string(),
    },
    returns: v.union(guildSecurityPolicyRecordValidator, v.null()),
    handler: async (ctx: SecurityPolicyQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedSecurityPolicyServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const policy = await findGuildSecurityPolicyDocument(ctx, guildId);

        return policy ? toGuildSecurityPolicyRecord(policy) : null;
    },
});

export const listGuildSecurityPoliciesByGuildIds = queryGeneric({
    args: {
        guildIds: v.array(v.string()),
    },
    returns: v.array(guildSecurityPolicyRecordValidator),
    handler: async (ctx: SecurityPolicyQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedSecurityPolicyServices);
        const guildIds = [...new Set(normalizeGuildIds(args.guildIds))].sort();

        if (guildIds.length === 0) {
            return [];
        }

        const policies = await Promise.all(guildIds.map((guildId) => findGuildSecurityPolicyDocument(ctx, guildId)));

        return policies.flatMap((policy) => (policy ? [toGuildSecurityPolicyRecord(policy)] : []));
    },
});

export const upsertGuildSecurityPolicy = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        defconLevel: defconLevelValidator,
        guildId: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: guildSecurityPolicyRecordValidator,
    handler: async (ctx: SecurityPolicyMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSecurityPolicyServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingPolicy = await findGuildSecurityPolicyDocument(ctx, guildId);
        const document = unwrap(
            buildGuildSecurityPolicyDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                existingPolicy ?? undefined
            )
        );

        if (existingPolicy) {
            await ctx.db.patch(existingPolicy._id, {
                defconLevel: document.defconLevel,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('guildSecurityPolicies', document);
        }

        return toGuildSecurityPolicyRecord(document);
    },
});

export const upsertGuildDefconExemption = mutationGeneric({
    args: {
        ...guildDefconExemptionIdentityArgs,
        createdAt: v.optional(v.string()),
        legacyId: v.optional(v.string()),
    },
    returns: guildDefconExemptionRecordValidator,
    handler: async (ctx: SecurityPolicyMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSecurityPolicyServices);
        const lookup = unwrap(normalizeDefconExemptionLookupInput(args));

        await requireGuildDocument(ctx, lookup.guildId);

        const existingExemption = await findGuildDefconExemptionDocument(ctx, lookup);

        if (existingExemption) {
            return toGuildDefconExemptionRecord(existingExemption);
        }

        const document = unwrap(
            buildGuildDefconExemptionDocument(
                {
                    ...args,
                    ...lookup,
                },
                new Date().toISOString(),
                () => crypto.randomUUID()
            )
        );

        await ctx.db.insert('guildDefconExemptions', document);

        return toGuildDefconExemptionRecord(document);
    },
});

export const listGuildDefconExemptionCategories = queryGeneric({
    args: {
        guildId: v.string(),
    },
    returns: v.array(v.string()),
    handler: async (ctx: SecurityPolicyQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedSecurityPolicyServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const exemptions = await ctx.db
            .query('guildDefconExemptions')
            .withIndex('by_guild_category', (query) => query.eq('guildId', guildId))
            .order('asc')
            .take(defconExemptionCategoryLimit);

        return exemptions.map((exemption) => exemption.category);
    },
});

export const deleteGuildDefconExemption = mutationGeneric({
    args: guildDefconExemptionIdentityArgs,
    returns: v.union(guildDefconExemptionRecordValidator, v.null()),
    handler: async (ctx: SecurityPolicyMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSecurityPolicyServices);
        const lookup = unwrap(normalizeDefconExemptionLookupInput(args));
        const exemption = await findGuildDefconExemptionDocument(ctx, lookup);

        if (!exemption) {
            return null;
        }

        await ctx.db.delete(exemption._id);

        return toGuildDefconExemptionRecord(exemption);
    },
});

async function findGuildSecurityPolicyDocument(
    ctx: SecurityPolicyQueryCtx | SecurityPolicyMutationCtx,
    guildId: string
): Promise<StoredGuildSecurityPolicyDocument | null> {
    return await ctx.db
        .query('guildSecurityPolicies')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();
}

async function findGuildDefconExemptionDocument(
    ctx: SecurityPolicyQueryCtx | SecurityPolicyMutationCtx,
    input: {
        category: string;
        guildId: string;
    }
): Promise<StoredGuildDefconExemptionDocument | null> {
    return await ctx.db
        .query('guildDefconExemptions')
        .withIndex('by_guild_category', (query) => query.eq('guildId', input.guildId).eq('category', input.category))
        .unique();
}

async function requireGuildDocument(ctx: SecurityPolicyMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: string; ok: false }): Value {
    if (!result.ok) {
        throw new Error(result.error);
    }

    return result.value;
}
