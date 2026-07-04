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
    buildDeploymentConfigDocument,
    normalizeListLimit,
    normalizeRequiredId,
    type DeploymentConfigDocument,
    type DeploymentConfigRecord,
} from './core_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type CoreQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type CoreMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = {
    _id: GenericId<'guilds'>;
    firstSeenAt: string;
    guildId: string;
    updatedAt: string;
};

type StoredBotInstallationDocument = {
    _id: GenericId<'botInstallations'>;
    guildId: string;
    installedAt: string;
    updatedAt: string;
};

type StoredDeploymentConfigDocument = {
    _id: GenericId<'deploymentConfig'>;
    createdAt: string;
    id: string;
    instanceMode: 'multi' | 'single';
    ownerIds: string[];
    publicWebUrl?: string;
    singleGuildId?: string;
    updatedAt: string;
};

type DeploymentConfigPatch = {
    instanceMode: DeploymentConfigDocument['instanceMode'];
    ownerIds: string[];
    publicWebUrl: string | undefined;
    singleGuildId: string | undefined;
    updatedAt: string;
};

const allowedRuntimeServices = ['bot', 'web'] as const;
const allowedMutationServices = ['bot'] as const;

const timestampValidator = v.string();
const guildIdArgs = {
    guildId: v.string(),
};
const guildRecordValidator = v.object({
    firstSeenAt: timestampValidator,
    guildId: v.string(),
    updatedAt: timestampValidator,
});
const botInstallationRecordValidator = v.object({
    guildId: v.string(),
    installedAt: timestampValidator,
    updatedAt: timestampValidator,
});
const stringPageValidator = v.object({
    guildIds: v.array(v.string()),
    nextCursor: v.optional(v.string()),
});
const deploymentConfigInputArgs = {
    instanceMode: v.union(v.literal('single'), v.literal('multi')),
    ownerIds: v.optional(v.array(v.string())),
    publicWebUrl: v.optional(v.string()),
    singleGuildId: v.optional(v.string()),
};
const deploymentConfigRecordValidator = v.union(
    v.object({
        instanceMode: v.literal('single'),
        ownerIds: v.array(v.string()),
        publicWebUrl: v.union(v.string(), v.null()),
        singleGuildId: v.string(),
    }),
    v.object({
        instanceMode: v.literal('multi'),
        ownerIds: v.array(v.string()),
        publicWebUrl: v.union(v.string(), v.null()),
    })
);

export const readDeploymentConfig = queryGeneric({
    args: {},
    returns: v.union(deploymentConfigRecordValidator, v.null()),
    handler: async (ctx: CoreQueryCtx) => {
        await requireNeonFluxService(ctx, allowedRuntimeServices);
        const config = await findDeploymentConfigDocument(ctx);

        return config ? toDeploymentConfigRecord(config) : null;
    },
});

export const upsertDeploymentConfig = mutationGeneric({
    args: deploymentConfigInputArgs,
    returns: deploymentConfigRecordValidator,
    handler: async (ctx: CoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedMutationServices);
        const now = new Date().toISOString();
        const existingConfig = await findDeploymentConfigDocument(ctx);
        const documentResult = buildDeploymentConfigDocument(args, now, existingConfig?.createdAt);

        if (!documentResult.ok) {
            throw new Error(documentResult.error);
        }

        const document = documentResult.value;

        if (existingConfig) {
            await ctx.db.patch(existingConfig._id, toDeploymentConfigPatch(document));
        } else {
            await ctx.db.insert('deploymentConfig', document);
        }

        return toDeploymentConfigRecord(document);
    },
});

export const readGuild = queryGeneric({
    args: guildIdArgs,
    returns: v.union(guildRecordValidator, v.null()),
    handler: async (ctx: CoreQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRuntimeServices);
        const guildId = normalizeRequiredGuildId(args.guildId);
        const guild = await findGuildDocument(ctx, guildId);

        return guild ? toGuildRecord(guild) : null;
    },
});

export const listGuildIdsPage = queryGeneric({
    args: {
        afterGuildId: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    returns: stringPageValidator,
    handler: async (ctx: CoreQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRuntimeServices);
        const guildIds = await takeGuildIdsPage(ctx, 'guilds', args.afterGuildId, args.limit);

        return toStringPage(guildIds, args.limit);
    },
});

export const upsertGuild = mutationGeneric({
    args: guildIdArgs,
    returns: guildRecordValidator,
    handler: async (ctx: CoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedMutationServices);
        const guild = await upsertGuildDocument(ctx, normalizeRequiredGuildId(args.guildId), new Date().toISOString());

        return toGuildRecord(guild);
    },
});

export const readBotInstallation = queryGeneric({
    args: guildIdArgs,
    returns: v.union(botInstallationRecordValidator, v.null()),
    handler: async (ctx: CoreQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRuntimeServices);
        const guildId = normalizeRequiredGuildId(args.guildId);
        const installation = await findBotInstallationDocument(ctx, guildId);

        return installation ? toBotInstallationRecord(installation) : null;
    },
});

export const listBotInstallationGuildIdsPage = queryGeneric({
    args: {
        afterGuildId: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    returns: stringPageValidator,
    handler: async (ctx: CoreQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRuntimeServices);
        const guildIds = await takeGuildIdsPage(ctx, 'botInstallations', args.afterGuildId, args.limit);

        return toStringPage(guildIds, args.limit);
    },
});

export const upsertBotInstallation = mutationGeneric({
    args: guildIdArgs,
    returns: botInstallationRecordValidator,
    handler: async (ctx: CoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedMutationServices);
        const now = new Date().toISOString();
        const guildId = normalizeRequiredGuildId(args.guildId);

        await upsertGuildDocument(ctx, guildId, now);

        const existingInstallation = await findBotInstallationDocument(ctx, guildId);

        if (existingInstallation) {
            await ctx.db.patch(existingInstallation._id, { updatedAt: now });

            return toBotInstallationRecord({
                ...existingInstallation,
                updatedAt: now,
            });
        }

        const document = {
            guildId,
            installedAt: now,
            updatedAt: now,
        };

        await ctx.db.insert('botInstallations', document);

        return document;
    },
});

export const deleteBotInstallation = mutationGeneric({
    args: guildIdArgs,
    returns: v.union(botInstallationRecordValidator, v.null()),
    handler: async (ctx: CoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedMutationServices);
        const guildId = normalizeRequiredGuildId(args.guildId);
        const installation = await findBotInstallationDocument(ctx, guildId);

        if (!installation) {
            return null;
        }

        await ctx.db.delete(installation._id);

        return toBotInstallationRecord(installation);
    },
});

async function findDeploymentConfigDocument(
    ctx: CoreQueryCtx | CoreMutationCtx
): Promise<StoredDeploymentConfigDocument | null> {
    return await ctx.db.query('deploymentConfig').withIndex('by_config_id').unique();
}

async function findGuildDocument(
    ctx: CoreQueryCtx | CoreMutationCtx,
    guildId: string
): Promise<StoredGuildDocument | null> {
    return await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();
}

async function findBotInstallationDocument(
    ctx: CoreQueryCtx | CoreMutationCtx,
    guildId: string
): Promise<StoredBotInstallationDocument | null> {
    return await ctx.db
        .query('botInstallations')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();
}

async function upsertGuildDocument(ctx: CoreMutationCtx, guildId: string, now: string): Promise<StoredGuildDocument> {
    const existingGuild = await findGuildDocument(ctx, guildId);

    if (existingGuild) {
        await ctx.db.patch(existingGuild._id, { updatedAt: now });

        return {
            ...existingGuild,
            updatedAt: now,
        };
    }

    const document = {
        firstSeenAt: now,
        guildId,
        updatedAt: now,
    };
    const id = await ctx.db.insert('guilds', document);

    return {
        ...document,
        _id: id,
    };
}

async function takeGuildIdsPage(
    ctx: CoreQueryCtx,
    tableName: 'botInstallations' | 'guilds',
    afterGuildId: string | undefined,
    requestedLimit: number | undefined
): Promise<string[]> {
    const limit = normalizeListLimit(requestedLimit);
    const normalizedAfterGuildId = afterGuildId?.trim();
    const rows = normalizedAfterGuildId
        ? await ctx.db
              .query(tableName)
              .withIndex('by_guild_id', (query) => query.gt('guildId', normalizedAfterGuildId))
              .order('asc')
              .take(limit + 1)
        : await ctx.db
              .query(tableName)
              .withIndex('by_guild_id')
              .order('asc')
              .take(limit + 1);

    return (rows as Array<{ guildId: string }>).map((row) => row.guildId);
}

function toStringPage(
    guildIds: string[],
    requestedLimit: number | undefined
): { guildIds: string[]; nextCursor?: string } {
    const limit = normalizeListLimit(requestedLimit);
    const pageGuildIds = guildIds.slice(0, limit);
    const nextCursor = guildIds.length > limit ? pageGuildIds.at(-1) : undefined;

    return {
        guildIds: pageGuildIds,
        ...(nextCursor ? { nextCursor } : {}),
    };
}

function normalizeRequiredGuildId(value: string): string {
    const result = normalizeRequiredId(value, 'missing-guild-id');

    if (!result.ok) {
        throw new Error(result.error);
    }

    return result.value;
}

function toDeploymentConfigPatch(document: DeploymentConfigDocument): DeploymentConfigPatch {
    const patch: DeploymentConfigPatch = {
        instanceMode: document.instanceMode,
        ownerIds: document.ownerIds,
        publicWebUrl: document.publicWebUrl,
        singleGuildId: document.instanceMode === 'single' ? document.singleGuildId : undefined,
        updatedAt: document.updatedAt,
    };

    return patch;
}

function toDeploymentConfigRecord(
    document: DeploymentConfigDocument | StoredDeploymentConfigDocument
): DeploymentConfigRecord {
    if (document.instanceMode === 'single') {
        if (!document.singleGuildId) {
            throw new Error('deployment-config-missing-single-guild-id');
        }

        return {
            instanceMode: document.instanceMode,
            ownerIds: document.ownerIds,
            publicWebUrl: document.publicWebUrl ?? null,
            singleGuildId: document.singleGuildId,
        };
    }

    return {
        instanceMode: document.instanceMode,
        ownerIds: document.ownerIds,
        publicWebUrl: document.publicWebUrl ?? null,
    };
}

function toGuildRecord(document: StoredGuildDocument): { firstSeenAt: string; guildId: string; updatedAt: string } {
    return {
        firstSeenAt: document.firstSeenAt,
        guildId: document.guildId,
        updatedAt: document.updatedAt,
    };
}

function toBotInstallationRecord(document: { guildId: string; installedAt: string; updatedAt: string }): {
    guildId: string;
    installedAt: string;
    updatedAt: string;
} {
    return {
        guildId: document.guildId,
        installedAt: document.installedAt,
        updatedAt: document.updatedAt,
    };
}
