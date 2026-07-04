import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import type schema from '../schema.js';
import {
    buildGeneratedVoiceChannelDocument,
    buildVcGeneratorControlPanelDocument,
    buildVcGeneratorRuleDocument,
    normalizeRequiredGuildId,
    normalizeRequiredLimit,
    toGeneratedVoiceChannelRecord,
    toVcGeneratorControlPanelRecord,
    toVcGeneratorRuleRecord,
    type GeneratedVoiceChannelDocument,
    type VcGeneratorControlPanelDocument,
    type VcGeneratorRuleDocument,
} from './vc_generator_model.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type VcGeneratorQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type VcGeneratorMutationCtx = GenericMutationCtx<NeonFluxDataModel>;
type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredRuleDocument = VcGeneratorRuleDocument & { _id: GenericId<'vcGeneratorRules'> };
type StoredGeneratedChannelDocument = GeneratedVoiceChannelDocument & { _id: GenericId<'generatedVoiceChannels'> };
type StoredControlPanelDocument = VcGeneratorControlPanelDocument & { _id: GenericId<'vcGeneratorControlPanels'> };

const allowedVcGeneratorServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const generatedChannelStatuses = ['active', 'deleted', 'orphaned'] as const;
const controlPanelStatuses = ['active', 'stale', 'disabled'] as const;
const ruleRecordValidator = v.object({
    categoryId: nullableString,
    config: v.any(),
    createdAt: v.string(),
    enabled: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    nameTemplate: v.string(),
    sourceChannelId: v.string(),
    updatedAt: v.string(),
});
const generatedChannelRecordValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    lastSeenAt: v.string(),
    ownerUserId: nullableString,
    ruleId: nullableString,
    status: v.string(),
    updatedAt: v.string(),
});
const controlPanelRecordValidator = v.object({
    channelId: v.string(),
    config: v.any(),
    controlMode: v.string(),
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    lastSyncedAt: nullableString,
    messageId: nullableString,
    ruleId: v.string(),
    staleAt: nullableString,
    status: v.string(),
    updatedAt: v.string(),
});

export const upsertVcGeneratorRule = mutationGeneric({
    args: {
        categoryId: v.optional(v.union(v.string(), v.null())),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        nameTemplate: v.string(),
        sourceChannelId: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: ruleRecordValidator,
    handler: async (ctx: VcGeneratorMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existing = await findRuleByGuildSource(ctx, { guildId, sourceChannelId: args.sourceChannelId });
        const document = unwrap(
            buildVcGeneratorRuleDocument({ ...args, guildId }, new Date().toISOString(), existing ?? undefined)
        );

        if (existing) {
            await ctx.db.patch(existing._id, {
                categoryId: document.categoryId,
                config: document.config,
                enabled: document.enabled,
                nameTemplate: document.nameTemplate,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('vcGeneratorRules', document);
        }

        return toVcGeneratorRuleRecord(document);
    },
});

export const listVcGeneratorRulesByGuildId = queryGeneric({
    args: { enabledOnly: v.optional(v.boolean()), guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(ruleRecordValidator),
    handler: async (ctx: VcGeneratorQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const rules = args.enabledOnly
            ? await ctx.db
                  .query('vcGeneratorRules')
                  .withIndex('by_guild_enabled_created', (query) => query.eq('guildId', guildId).eq('enabled', true))
                  .order('asc')
                  .take(normalizeRequiredLimit(args.limit))
            : await ctx.db
                  .query('vcGeneratorRules')
                  .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
                  .order('asc')
                  .take(normalizeRequiredLimit(args.limit));

        return rules.map(toVcGeneratorRuleRecord);
    },
});

export const findVcGeneratorRuleBySourceChannelId = queryGeneric({
    args: { enabledOnly: v.optional(v.boolean()), guildId: v.string(), sourceChannelId: v.string() },
    returns: v.union(ruleRecordValidator, v.null()),
    handler: async (ctx: VcGeneratorQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const rule = await findRuleByGuildSource(ctx, args);

        if (!rule || (args.enabledOnly && !rule.enabled)) return null;

        return toVcGeneratorRuleRecord(rule);
    },
});

export const deleteVcGeneratorRule = mutationGeneric({
    args: { guildId: v.string(), sourceChannelId: v.string() },
    returns: v.union(ruleRecordValidator, v.null()),
    handler: async (ctx: VcGeneratorMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const rule = await findRuleByGuildSource(ctx, args);

        if (!rule) return null;

        const panels = await ctx.db
            .query('vcGeneratorControlPanels')
            .withIndex('by_guild_rule', (query) => query.eq('guildId', rule.guildId).eq('ruleLegacyId', rule.legacyId))
            .take(500);
        const generatedChannels = await ctx.db
            .query('generatedVoiceChannels')
            .withIndex('by_guild_rule_created', (query) =>
                query.eq('guildId', rule.guildId).eq('ruleLegacyId', rule.legacyId)
            )
            .take(500);

        for (const panel of panels) await ctx.db.delete(panel._id);
        for (const channel of generatedChannels) await ctx.db.patch(channel._id, { ruleLegacyId: undefined });
        await ctx.db.delete(rule._id);

        return toVcGeneratorRuleRecord(rule);
    },
});

export const upsertGeneratedVoiceChannel = mutationGeneric({
    args: {
        channelId: v.string(),
        createdAt: v.optional(v.string()),
        guildId: v.string(),
        lastSeenAt: v.optional(v.string()),
        legacyId: v.optional(v.string()),
        ownerUserId: v.optional(v.union(v.string(), v.null())),
        ruleId: v.optional(v.union(v.string(), v.null())),
        status: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: generatedChannelRecordValidator,
    handler: async (ctx: VcGeneratorMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        await requireRuleIfProvided(ctx, { guildId, ruleId: args.ruleId ?? undefined });

        const existing = await findGeneratedByChannelId(ctx, args.channelId);
        const document = unwrap(
            buildGeneratedVoiceChannelDocument({ ...args, guildId }, new Date().toISOString(), existing ?? undefined)
        );

        if (existing) {
            await ctx.db.patch(existing._id, {
                lastSeenAt: document.lastSeenAt,
                ownerUserId: document.ownerUserId,
                ruleLegacyId: document.ruleLegacyId,
                status: document.status,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('generatedVoiceChannels', document);
        }

        return toGeneratedVoiceChannelRecord(document);
    },
});

export const findGeneratedVoiceChannelByChannelId = queryGeneric({
    args: { channelId: v.string() },
    returns: v.union(generatedChannelRecordValidator, v.null()),
    handler: async (ctx: VcGeneratorQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const channel = await findGeneratedByChannelId(ctx, args.channelId);

        return channel ? toGeneratedVoiceChannelRecord(channel) : null;
    },
});

export const listGeneratedVoiceChannelsByGuildId = queryGeneric({
    args: {
        guildId: v.string(),
        limit: v.optional(v.number()),
        ruleId: v.optional(v.string()),
        status: v.optional(v.string()),
    },
    returns: v.array(generatedChannelRecordValidator),
    handler: async (ctx: VcGeneratorQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        assertStatus(args.status, generatedChannelStatuses, 'status');
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const limit = normalizeRequiredLimit(args.limit);
        const ruleId = args.ruleId;
        const status = args.status;

        if (ruleId && status) {
            const rows = await ctx.db
                .query('generatedVoiceChannels')
                .withIndex('by_guild_rule_status', (query) =>
                    query.eq('guildId', guildId).eq('ruleLegacyId', ruleId).eq('status', status)
                )
                .take(limit);

            return rows.map(toGeneratedVoiceChannelRecord);
        }
        if (ruleId) {
            const rows = await ctx.db
                .query('generatedVoiceChannels')
                .withIndex('by_guild_rule_created', (query) => query.eq('guildId', guildId).eq('ruleLegacyId', ruleId))
                .order('asc')
                .take(limit);

            return rows.map(toGeneratedVoiceChannelRecord);
        }
        if (status) {
            const rows = await ctx.db
                .query('generatedVoiceChannels')
                .withIndex('by_guild_status', (query) => query.eq('guildId', guildId).eq('status', status))
                .take(limit);

            return rows.map(toGeneratedVoiceChannelRecord);
        }

        const rows = await ctx.db
            .query('generatedVoiceChannels')
            .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
            .order('asc')
            .take(limit);

        return rows.map(toGeneratedVoiceChannelRecord);
    },
});

export const updateGeneratedVoiceChannelStatus = mutationGeneric({
    args: { channelId: v.string(), guildId: v.string(), status: v.string() },
    returns: v.union(generatedChannelRecordValidator, v.null()),
    handler: async (ctx: VcGeneratorMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        assertStatus(args.status, generatedChannelStatuses, 'status');
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const channel = await findGeneratedByChannelId(ctx, args.channelId);

        if (!channel || channel.guildId !== guildId) return null;

        const updated = unwrap(
            buildGeneratedVoiceChannelDocument({ ...channel, status: args.status }, new Date().toISOString(), channel)
        );
        await ctx.db.patch(channel._id, {
            lastSeenAt: updated.lastSeenAt,
            status: updated.status,
            updatedAt: updated.updatedAt,
        });

        return toGeneratedVoiceChannelRecord(updated);
    },
});

export const upsertVcGeneratorControlPanel = mutationGeneric({
    args: {
        channelId: v.string(),
        config: v.optional(v.any()),
        controlMode: v.optional(v.string()),
        guildId: v.string(),
        messageId: v.optional(v.union(v.string(), v.null())),
        ruleId: v.string(),
        status: v.optional(v.string()),
        synced: v.optional(v.boolean()),
    },
    returns: controlPanelRecordValidator,
    handler: async (ctx: VcGeneratorMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireRule(ctx, { guildId, ruleId: args.ruleId });

        const existing = await findControlPanelByGuildRule(ctx, { guildId, ruleId: args.ruleId });
        const document = unwrap(
            buildVcGeneratorControlPanelDocument({ ...args, guildId }, new Date().toISOString(), existing ?? undefined)
        );

        if (existing) {
            await ctx.db.patch(existing._id, {
                channelId: document.channelId,
                config: document.config,
                controlMode: document.controlMode,
                lastSyncedAt: document.lastSyncedAt,
                messageId: document.messageId,
                staleAt: document.staleAt,
                status: document.status,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('vcGeneratorControlPanels', document);
        }

        return toVcGeneratorControlPanelRecord(document);
    },
});

export const findVcGeneratorControlPanelByMessageId = queryGeneric({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(controlPanelRecordValidator, v.null()),
    handler: async (ctx: VcGeneratorQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const panel = await ctx.db
            .query('vcGeneratorControlPanels')
            .withIndex('by_guild_message', (query) => query.eq('guildId', args.guildId).eq('messageId', args.messageId))
            .unique();

        return panel ? toVcGeneratorControlPanelRecord(panel) : null;
    },
});

export const findVcGeneratorControlPanelByRuleId = queryGeneric({
    args: { guildId: v.string(), ruleId: v.string() },
    returns: v.union(controlPanelRecordValidator, v.null()),
    handler: async (ctx: VcGeneratorQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        const panel = await findControlPanelByGuildRule(ctx, args);

        return panel ? toVcGeneratorControlPanelRecord(panel) : null;
    },
});

export const listVcGeneratorControlPanelsByGuildId = queryGeneric({
    args: { guildId: v.string(), limit: v.optional(v.number()), status: v.optional(v.string()) },
    returns: v.array(controlPanelRecordValidator),
    handler: async (ctx: VcGeneratorQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVcGeneratorServices);
        assertStatus(args.status, controlPanelStatuses, 'status');
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const status = args.status;
        const panels = status
            ? await ctx.db
                  .query('vcGeneratorControlPanels')
                  .withIndex('by_guild_status', (query) => query.eq('guildId', guildId).eq('status', status))
                  .take(normalizeRequiredLimit(args.limit))
            : await ctx.db
                  .query('vcGeneratorControlPanels')
                  .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
                  .order('asc')
                  .take(normalizeRequiredLimit(args.limit));

        return panels.map(toVcGeneratorControlPanelRecord);
    },
});

async function findRuleByGuildSource(
    ctx: VcGeneratorQueryCtx | VcGeneratorMutationCtx,
    input: { guildId: string; sourceChannelId: string }
): Promise<StoredRuleDocument | null> {
    const guildId = unwrap(normalizeRequiredGuildId(input.guildId));
    const sourceChannelId = unwrapRequiredString(input.sourceChannelId, 'sourceChannelId');

    return await ctx.db
        .query('vcGeneratorRules')
        .withIndex('by_guild_source', (query) => query.eq('guildId', guildId).eq('sourceChannelId', sourceChannelId))
        .unique();
}

async function findRuleByLegacyId(
    ctx: VcGeneratorQueryCtx | VcGeneratorMutationCtx,
    ruleId: string
): Promise<StoredRuleDocument | null> {
    return await ctx.db
        .query('vcGeneratorRules')
        .withIndex('by_legacy', (query) => query.eq('legacyId', unwrapRequiredString(ruleId, 'ruleId')))
        .unique();
}

async function findGeneratedByChannelId(
    ctx: VcGeneratorQueryCtx | VcGeneratorMutationCtx,
    channelId: string
): Promise<StoredGeneratedChannelDocument | null> {
    return await ctx.db
        .query('generatedVoiceChannels')
        .withIndex('by_channel', (query) => query.eq('channelId', unwrapRequiredString(channelId, 'channelId')))
        .unique();
}

async function findControlPanelByGuildRule(
    ctx: VcGeneratorQueryCtx | VcGeneratorMutationCtx,
    input: { guildId: string; ruleId: string }
): Promise<StoredControlPanelDocument | null> {
    return await ctx.db
        .query('vcGeneratorControlPanels')
        .withIndex('by_guild_rule', (query) =>
            query
                .eq('guildId', unwrapRequiredString(input.guildId, 'guildId'))
                .eq('ruleLegacyId', unwrapRequiredString(input.ruleId, 'ruleId'))
        )
        .unique();
}

async function requireRuleIfProvided(
    ctx: VcGeneratorMutationCtx,
    input: { guildId: string; ruleId?: string | null | undefined }
): Promise<void> {
    const ruleId = normalizeOptionalString(input.ruleId);
    if (!ruleId) return;
    await requireRule(ctx, { guildId: input.guildId, ruleId });
}

async function requireRule(
    ctx: VcGeneratorMutationCtx,
    input: { guildId: string; ruleId: string }
): Promise<StoredRuleDocument> {
    const rule = await findRuleByLegacyId(ctx, input.ruleId);
    if (!rule || rule.guildId !== input.guildId) throw new Error('vc-generator-rule-not-found');
    return rule;
}

async function requireGuildDocument(ctx: VcGeneratorMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');
    return guild;
}

function assertStatus(value: string | undefined, allowed: readonly string[], field: string): void {
    if (value !== undefined && !allowed.includes(value)) throw new Error(`${field}-invalid-value`);
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

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;
        if (typeof error === 'object' && error !== null && 'type' in error) throw new Error(String(error.type));
        throw new Error(String(error));
    }
    return result.value;
}
