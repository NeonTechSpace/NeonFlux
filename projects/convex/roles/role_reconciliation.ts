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
    ROLE_RECONCILIATION_FEATURE,
    buildRoleReconciliationActionDocument,
    buildRoleReconciliationRunDocument,
    buildRoleReconciliationRunStatusPatch,
    buildRoleReconciliationSettingsDocument,
    defaultRoleReconciliationSettingsRecord,
    normalizeRequiredGuildId,
    normalizeRequiredRunId,
    toRoleReconciliationActionRecord,
    toRoleReconciliationRunRecord,
    toRoleReconciliationSettingsRecord,
    type RoleReconciliationActionDocument,
    type RoleReconciliationRunDocument,
} from './role_reconciliation_model.js';
import type schema from '../schema.js';
import type { GuildFeatureSettingDocument } from '../core/feature_settings_model.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type RoleReconciliationQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type RoleReconciliationMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredGuildFeatureSettingDocument = GuildFeatureSettingDocument & {
    _id: GenericId<'guildFeatureSettings'>;
};
type StoredRoleReconciliationRunDocument = RoleReconciliationRunDocument & {
    _id: GenericId<'roleReconciliationRuns'>;
};
type StoredRoleReconciliationActionDocument = RoleReconciliationActionDocument & {
    _id: GenericId<'roleReconciliationActions'>;
};

const allowedRoleReconciliationServices = ['bot', 'web', 'migration'] as const;
const settingsRecordValidator = v.object({
    cleanupDeletedRoleReferences: v.boolean(),
    createdAt: v.optional(v.string()),
    enabled: v.boolean(),
    guildId: v.string(),
    restoreAutoroleRoles: v.boolean(),
    restoreReactionRoles: v.boolean(),
    restoreVerificationRoles: v.boolean(),
    updatedAt: v.optional(v.string()),
});
const runRecordValidator = v.object({
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    status: v.string(),
    summary: v.any(),
    updatedAt: v.string(),
});
const actionRecordValidator = v.object({
    actionType: v.string(),
    createdAt: v.string(),
    details: v.any(),
    id: v.string(),
    roleId: v.union(v.string(), v.null()),
    runId: v.string(),
    status: v.string(),
    updatedAt: v.string(),
});

export const findRoleReconciliationSettingsByGuildId = queryGeneric({
    args: { guildId: v.string() },
    returns: settingsRecordValidator,
    handler: async (ctx: RoleReconciliationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const setting = await findRoleReconciliationSettingDocument(ctx, guildId);

        return setting ? toRoleReconciliationSettingsRecord(setting) : defaultRoleReconciliationSettingsRecord(guildId);
    },
});

export const upsertRoleReconciliationSettings = mutationGeneric({
    args: {
        cleanupDeletedRoleReferences: v.optional(v.boolean()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        restoreAutoroleRoles: v.optional(v.boolean()),
        restoreReactionRoles: v.optional(v.boolean()),
        restoreVerificationRoles: v.optional(v.boolean()),
        updatedAt: v.optional(v.string()),
    },
    returns: settingsRecordValidator,
    handler: async (ctx: RoleReconciliationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingSetting = await findRoleReconciliationSettingDocument(ctx, guildId);
        const document = unwrap(
            buildRoleReconciliationSettingsDocument(
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

        return toRoleReconciliationSettingsRecord(document);
    },
});

export const createRoleReconciliationRun = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        status: v.optional(v.string()),
        summary: v.optional(v.any()),
        updatedAt: v.optional(v.string()),
    },
    returns: runRecordValidator,
    handler: async (ctx: RoleReconciliationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const document = unwrap(
            buildRoleReconciliationRunDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                () => crypto.randomUUID()
            )
        );

        await ctx.db.insert('roleReconciliationRuns', document);

        return toRoleReconciliationRunRecord(document);
    },
});

export const listRoleReconciliationRunsByGuildId = queryGeneric({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(runRecordValidator),
    handler: async (ctx: RoleReconciliationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const runs = await ctx.db
            .query('roleReconciliationRuns')
            .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
            .order('desc')
            .take(normalizeLimit(args.limit));

        return runs.map(toRoleReconciliationRunRecord);
    },
});

export const updateRoleReconciliationRunStatus = mutationGeneric({
    args: {
        runId: v.string(),
        status: v.string(),
        summary: v.optional(v.any()),
        updatedAt: v.optional(v.string()),
    },
    returns: v.union(runRecordValidator, v.null()),
    handler: async (ctx: RoleReconciliationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const runId = unwrap(normalizeRequiredRunId(args.runId));
        const run = await findRoleReconciliationRunByLegacyId(ctx, runId);

        if (!run) return null;

        const patchInput = {
            status: args.status,
            ...(args.summary === undefined ? {} : { summary: args.summary }),
            ...(args.updatedAt === undefined ? {} : { updatedAt: args.updatedAt }),
        };
        const patch = unwrap(buildRoleReconciliationRunStatusPatch(run, patchInput, new Date().toISOString()));

        await ctx.db.patch(run._id, patch);

        return toRoleReconciliationRunRecord({
            ...run,
            ...patch,
        });
    },
});

export const recordRoleReconciliationAction = mutationGeneric({
    args: {
        actionType: v.string(),
        createdAt: v.optional(v.string()),
        details: v.optional(v.any()),
        legacyId: v.optional(v.string()),
        roleId: v.optional(v.string()),
        runId: v.string(),
        status: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: actionRecordValidator,
    handler: async (ctx: RoleReconciliationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const runId = unwrap(normalizeRequiredRunId(args.runId));

        await requireRoleReconciliationRun(ctx, runId);

        const document = unwrap(
            buildRoleReconciliationActionDocument(
                {
                    ...args,
                    runId,
                },
                new Date().toISOString(),
                () => crypto.randomUUID()
            )
        );

        await ctx.db.insert('roleReconciliationActions', document);

        return toRoleReconciliationActionRecord(document);
    },
});

export const listRoleReconciliationActionsByRunId = queryGeneric({
    args: {
        limit: v.optional(v.number()),
        runId: v.string(),
        status: v.optional(v.string()),
    },
    returns: v.array(actionRecordValidator),
    handler: async (ctx: RoleReconciliationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const runId = unwrap(normalizeRequiredRunId(args.runId));
        const actions =
            args.status === undefined
                ? await ctx.db
                      .query('roleReconciliationActions')
                      .withIndex('by_run_created', (query) => query.eq('runLegacyId', runId))
                      .order('asc')
                      .take(normalizeLimit(args.limit))
                : await ctx.db
                      .query('roleReconciliationActions')
                      .withIndex('by_run_status', (query) =>
                          query.eq('runLegacyId', runId).eq('status', args.status!.trim())
                      )
                      .order('asc')
                      .take(normalizeLimit(args.limit));

        return actions.map(toRoleReconciliationActionRecord);
    },
});

async function findRoleReconciliationSettingDocument(
    ctx: RoleReconciliationQueryCtx | RoleReconciliationMutationCtx,
    guildId: string
): Promise<StoredGuildFeatureSettingDocument | null> {
    return await ctx.db
        .query('guildFeatureSettings')
        .withIndex('by_guild_feature', (query) =>
            query.eq('guildId', guildId).eq('feature', ROLE_RECONCILIATION_FEATURE)
        )
        .unique();
}

async function findRoleReconciliationRunByLegacyId(
    ctx: RoleReconciliationQueryCtx | RoleReconciliationMutationCtx,
    legacyId: string
): Promise<StoredRoleReconciliationRunDocument | null> {
    return await ctx.db
        .query('roleReconciliationRuns')
        .withIndex('by_legacy', (query) => query.eq('legacyId', legacyId))
        .unique();
}

async function requireRoleReconciliationRun(
    ctx: RoleReconciliationMutationCtx,
    legacyId: string
): Promise<StoredRoleReconciliationRunDocument> {
    const run = await findRoleReconciliationRunByLegacyId(ctx, legacyId);

    if (!run) {
        throw new Error('role-reconciliation-run-not-found');
    }

    return run;
}

async function requireGuildDocument(ctx: RoleReconciliationMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function normalizeLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return 100;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 500);
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
