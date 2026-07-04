import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import {
    buildAutomodEventDocument,
    buildAutomodEventStatusPatch,
    buildAutomodRuleDocument,
    normalizeAutomodListLimit,
    normalizeRequiredEventId,
    normalizeRequiredGuildId,
    normalizeRequiredRuleId,
    toAutomodEventRecord,
    toAutomodRuleRecord,
    type AutomodEventDocument,
    type AutomodRuleDocument,
} from './automod_model.js';
import { requireNeonFluxService } from '../auth.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type AutomodQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type AutomodMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = {
    _id: GenericId<'guilds'>;
    guildId: string;
};

type StoredAutomodRuleDocument = AutomodRuleDocument & {
    _id: GenericId<'automodRules'>;
};

type StoredAutomodEventDocument = AutomodEventDocument & {
    _id: GenericId<'automodEvents'>;
};

const allowedAutomodServices = ['bot', 'web'] as const;
const automodTriggerTypeValidator = v.union(v.literal('blocked_terms'), v.literal('invite_links'));
const automodActionTypeValidator = v.union(
    v.literal('record'),
    v.literal('delete_message'),
    v.literal('timeout'),
    v.literal('warn')
);
const automodRuleRecordValidator = v.object({
    actionType: automodActionTypeValidator,
    config: v.any(),
    createdAt: v.string(),
    enabled: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    name: v.string(),
    triggerType: automodTriggerTypeValidator,
    updatedAt: v.string(),
});
const automodEventRecordValidator = v.object({
    actionType: automodActionTypeValidator,
    authorUserId: v.string(),
    channelId: v.string(),
    createdAt: v.string(),
    details: v.any(),
    guildId: v.string(),
    id: v.string(),
    messageId: v.string(),
    ruleId: v.union(v.string(), v.null()),
    status: v.string(),
    triggerType: automodTriggerTypeValidator,
});

export const listAutomodRulesByGuildId = queryGeneric({
    args: {
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(automodRuleRecordValidator),
    handler: async (ctx: AutomodQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutomodServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const limit = unwrap(normalizeAutomodListLimit(args.limit));
        const rules = await ctx.db
            .query('automodRules')
            .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
            .order('desc')
            .take(limit);

        return rules.map(toAutomodRuleRecord);
    },
});

export const listEnabledAutomodRulesByGuildId = queryGeneric({
    args: {
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(automodRuleRecordValidator),
    handler: async (ctx: AutomodQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutomodServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const limit = unwrap(normalizeAutomodListLimit(args.limit));
        const rules = await ctx.db
            .query('automodRules')
            .withIndex('by_guild_enabled_created', (query) => query.eq('guildId', guildId).eq('enabled', true))
            .order('desc')
            .take(limit);

        return rules.map(toAutomodRuleRecord);
    },
});

export const saveAutomodRule = mutationGeneric({
    args: {
        actionType: v.optional(v.string()),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        name: v.string(),
        ruleId: v.optional(v.string()),
        triggerType: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: automodRuleRecordValidator,
    handler: async (ctx: AutomodMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutomodServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingRule = args.ruleId
            ? await findAutomodRuleByLegacyIdDocument(ctx, { guildId, legacyId: args.ruleId })
            : await findAutomodRuleByNameDocument(ctx, { guildId, name: args.name });

        if (args.ruleId && !existingRule) {
            throw new Error('not-found');
        }

        const document = unwrap(
            buildAutomodRuleDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                existingRule ?? undefined,
                () => crypto.randomUUID()
            )
        );

        if (existingRule) {
            await ctx.db.patch(existingRule._id, {
                actionType: document.actionType,
                config: document.config,
                enabled: document.enabled,
                name: document.name,
                triggerType: document.triggerType,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('automodRules', document);
        }

        return toAutomodRuleRecord(document);
    },
});

export const deleteAutomodRule = mutationGeneric({
    args: {
        guildId: v.string(),
        ruleId: v.string(),
    },
    returns: v.union(automodRuleRecordValidator, v.null()),
    handler: async (ctx: AutomodMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutomodServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const ruleId = unwrap(normalizeRequiredRuleId(args.ruleId));
        const rule = await findAutomodRuleByLegacyIdDocument(ctx, { guildId, legacyId: ruleId });

        if (!rule) {
            return null;
        }

        await ctx.db.delete(rule._id);

        return toAutomodRuleRecord(rule);
    },
});

export const recordAutomodEvent = mutationGeneric({
    args: {
        actionType: v.optional(v.string()),
        authorUserId: v.string(),
        channelId: v.string(),
        createdAt: v.optional(v.string()),
        details: v.optional(v.any()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        messageId: v.string(),
        ruleId: v.optional(v.string()),
        status: v.optional(v.string()),
        triggerType: v.string(),
    },
    returns: automodEventRecordValidator,
    handler: async (ctx: AutomodMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutomodServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        if (args.ruleId) {
            await requireAutomodRuleLegacyId(ctx, args.ruleId);
        }

        const document = unwrap(
            buildAutomodEventDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                () => crypto.randomUUID()
            )
        );

        await ctx.db.insert('automodEvents', document);

        return toAutomodEventRecord(document);
    },
});

export const updateAutomodEventStatus = mutationGeneric({
    args: {
        details: v.optional(v.any()),
        eventId: v.string(),
        status: v.string(),
    },
    returns: v.union(automodEventRecordValidator, v.null()),
    handler: async (ctx: AutomodMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutomodServices);
        const eventId = unwrap(normalizeRequiredEventId(args.eventId));
        const event = await findAutomodEventByLegacyIdDocument(ctx, eventId);

        if (!event) {
            return null;
        }

        const patch = unwrap(buildAutomodEventStatusPatch(args, event.details));

        await ctx.db.patch(event._id, patch);

        return toAutomodEventRecord({
            ...event,
            ...patch,
        });
    },
});

export const listAutomodEventsByGuildId = queryGeneric({
    args: {
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(automodEventRecordValidator),
    handler: async (ctx: AutomodQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAutomodServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const limit = unwrap(normalizeAutomodListLimit(args.limit));
        const events = await ctx.db
            .query('automodEvents')
            .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
            .order('desc')
            .take(limit);

        return events.map(toAutomodEventRecord);
    },
});

async function findAutomodRuleByLegacyIdDocument(
    ctx: AutomodQueryCtx | AutomodMutationCtx,
    input: {
        guildId: string;
        legacyId: string;
    }
): Promise<StoredAutomodRuleDocument | null> {
    return await ctx.db
        .query('automodRules')
        .withIndex('by_guild_legacy', (query) => query.eq('guildId', input.guildId).eq('legacyId', input.legacyId))
        .unique();
}

async function findAutomodRuleByNameDocument(
    ctx: AutomodQueryCtx | AutomodMutationCtx,
    input: {
        guildId: string;
        name: string;
    }
): Promise<StoredAutomodRuleDocument | null> {
    return await ctx.db
        .query('automodRules')
        .withIndex('by_guild_name', (query) => query.eq('guildId', input.guildId).eq('name', input.name.trim()))
        .unique();
}

async function requireAutomodRuleLegacyId(ctx: AutomodMutationCtx, legacyId: string): Promise<void> {
    const rule = await ctx.db
        .query('automodRules')
        .withIndex('by_legacy', (query) => query.eq('legacyId', legacyId))
        .unique();

    if (!rule) {
        throw new Error('automod-rule-not-found');
    }
}

async function findAutomodEventByLegacyIdDocument(
    ctx: AutomodMutationCtx,
    legacyId: string
): Promise<StoredAutomodEventDocument | null> {
    return await ctx.db
        .query('automodEvents')
        .withIndex('by_legacy', (query) => query.eq('legacyId', legacyId))
        .unique();
}

async function requireGuildDocument(ctx: AutomodMutationCtx, guildId: string): Promise<StoredGuildDocument> {
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
