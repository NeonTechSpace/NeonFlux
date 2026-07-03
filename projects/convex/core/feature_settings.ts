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
    buildGuildFeatureSettingDocument,
    normalizeAfterFeature,
    normalizeGuildFeatureSettingLimit,
    normalizeRequiredGuildFeatureString,
    toGuildFeatureSettingRecord,
    type GuildFeatureSettingDocument,
} from './feature_settings_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type FeatureSettingsQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type FeatureSettingsMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = {
    _id: GenericId<'guilds'>;
    guildId: string;
};

type StoredGuildFeatureSettingDocument = GuildFeatureSettingDocument & {
    _id: GenericId<'guildFeatureSettings'>;
};

const allowedFeatureSettingServices = ['bot', 'web', 'migration'] as const;

const guildFeatureSettingRecordValidator = v.object({
    config: v.any(),
    createdAt: v.string(),
    enabled: v.boolean(),
    feature: v.string(),
    guildId: v.string(),
    id: v.string(),
    updatedAt: v.string(),
});
const guildFeatureSettingPageValidator = v.object({
    nextCursor: v.optional(v.string()),
    records: v.array(guildFeatureSettingRecordValidator),
});
const guildFeatureSettingIdentityArgs = {
    feature: v.string(),
    guildId: v.string(),
};

export const readGuildFeatureSetting = queryGeneric({
    args: guildFeatureSettingIdentityArgs,
    returns: v.union(guildFeatureSettingRecordValidator, v.null()),
    handler: async (ctx: FeatureSettingsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedFeatureSettingServices);
        const guildId = unwrap(normalizeRequiredGuildFeatureString(args.guildId, 'missing-guild-id'));
        const feature = unwrap(normalizeRequiredGuildFeatureString(args.feature, 'missing-feature'));
        const setting = await findGuildFeatureSettingDocument(ctx, guildId, feature);

        return setting ? toGuildFeatureSettingRecord(setting) : null;
    },
});

export const listGuildFeatureSettingsByGuildId = queryGeneric({
    args: {
        afterFeature: v.optional(v.string()),
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: guildFeatureSettingPageValidator,
    handler: async (ctx: FeatureSettingsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedFeatureSettingServices);
        const guildId = unwrap(normalizeRequiredGuildFeatureString(args.guildId, 'missing-guild-id'));
        const limit = normalizeGuildFeatureSettingLimit(args.limit);
        const afterFeature = normalizeAfterFeature(args.afterFeature);
        const settings = await takeGuildFeatureSettingDocuments(ctx, {
            ...(afterFeature ? { afterFeature } : {}),
            guildId,
            limit: limit + 1,
        });
        const records = settings.slice(0, limit).map(toGuildFeatureSettingRecord);
        const extraSetting = settings.at(limit);

        return {
            ...(extraSetting ? { nextCursor: records.at(-1)?.feature ?? extraSetting.feature } : {}),
            records,
        };
    },
});

export const upsertGuildFeatureSetting = mutationGeneric({
    args: {
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        feature: v.string(),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: guildFeatureSettingRecordValidator,
    handler: async (ctx: FeatureSettingsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedFeatureSettingServices);
        const guildId = unwrap(normalizeRequiredGuildFeatureString(args.guildId, 'missing-guild-id'));

        await requireGuildDocument(ctx, guildId);

        const existingSetting = await findGuildFeatureSettingDocument(ctx, guildId, args.feature);
        const document = unwrap(
            buildGuildFeatureSettingDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                existingSetting ?? undefined,
                () => crypto.randomUUID()
            )
        );

        if (existingSetting) {
            await ctx.db.patch(existingSetting._id, {
                config: document.config,
                enabled: document.enabled,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('guildFeatureSettings', document);
        }

        return toGuildFeatureSettingRecord(document);
    },
});

export const deleteGuildFeatureSetting = mutationGeneric({
    args: guildFeatureSettingIdentityArgs,
    returns: v.union(guildFeatureSettingRecordValidator, v.null()),
    handler: async (ctx: FeatureSettingsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedFeatureSettingServices);
        const guildId = unwrap(normalizeRequiredGuildFeatureString(args.guildId, 'missing-guild-id'));
        const feature = unwrap(normalizeRequiredGuildFeatureString(args.feature, 'missing-feature'));
        const setting = await findGuildFeatureSettingDocument(ctx, guildId, feature);

        if (!setting) {
            return null;
        }

        await ctx.db.delete(setting._id);

        return toGuildFeatureSettingRecord(setting);
    },
});

async function findGuildFeatureSettingDocument(
    ctx: FeatureSettingsQueryCtx | FeatureSettingsMutationCtx,
    guildId: string,
    feature: string
): Promise<StoredGuildFeatureSettingDocument | null> {
    return await ctx.db
        .query('guildFeatureSettings')
        .withIndex('by_guild_feature', (query) => query.eq('guildId', guildId).eq('feature', feature))
        .unique();
}

async function takeGuildFeatureSettingDocuments(
    ctx: FeatureSettingsQueryCtx,
    input: {
        afterFeature?: string;
        guildId: string;
        limit: number;
    }
): Promise<StoredGuildFeatureSettingDocument[]> {
    const indexedQuery = ctx.db
        .query('guildFeatureSettings')
        .withIndex('by_guild_feature', (query) =>
            input.afterFeature
                ? query.eq('guildId', input.guildId).gt('feature', input.afterFeature)
                : query.eq('guildId', input.guildId)
        );

    return await indexedQuery.order('asc').take(input.limit);
}

async function requireGuildDocument(ctx: FeatureSettingsMutationCtx, guildId: string): Promise<StoredGuildDocument> {
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
