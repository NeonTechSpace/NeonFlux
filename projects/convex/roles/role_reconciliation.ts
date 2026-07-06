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
    type RoleReconciliationRunDocument,
} from './role_reconciliation_model.js';
import type { GuildFeatureSettingDocument } from '../core/feature_settings_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type RoleReconciliationQueryCtx = QueryCtx;
type RoleReconciliationMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredGuildFeatureSettingDocument = GuildFeatureSettingDocument & {
    _id: GenericId<'guildFeatureSettings'>;
};
type StoredRoleReconciliationRunDocument = RoleReconciliationRunDocument & {
    _id: GenericId<'roleReconciliationRuns'>;
};

const allowedRoleReconciliationServices = ['bot', 'web'] as const;
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

export const findRoleReconciliationSettingsByGuildId = query({
    args: { guildId: v.string() },
    returns: settingsRecordValidator,
    handler: async (ctx: RoleReconciliationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const setting = await findRoleReconciliationSettingDocument(ctx, guildId);

        return setting ? toRoleReconciliationSettingsRecord(setting) : defaultRoleReconciliationSettingsRecord(guildId);
    },
});

export const upsertRoleReconciliationSettings = mutation({
    args: {
        cleanupDeletedRoleReferences: v.optional(v.boolean()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
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
                existingSetting ?? undefined
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

export const createRoleReconciliationRun = mutation({
    args: {
        createdAt: v.optional(v.string()),
        guildId: v.string(),
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
                new Date().toISOString()
            )
        );

        const id = await ctx.db.insert('roleReconciliationRuns', document);

        return toRoleReconciliationRunRecord({ ...document, _id: id });
    },
});

export const listRoleReconciliationRunsByGuildId = query({
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

export const updateRoleReconciliationRunStatus = mutation({
    args: {
        runId: v.string(),
        status: v.string(),
        summary: v.optional(v.any()),
        updatedAt: v.optional(v.string()),
    },
    returns: v.union(runRecordValidator, v.null()),
    handler: async (ctx: RoleReconciliationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const runId = parseRunId(args.runId);
        const run = await findRoleReconciliationRunById(ctx, runId);

        if (!run) return null;

        const summary = normalizeOptionalRecord(args.summary);
        const patchInput = {
            status: args.status,
            ...(summary === undefined ? {} : { summary }),
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

export const recordRoleReconciliationAction = mutation({
    args: {
        actionType: v.string(),
        createdAt: v.optional(v.string()),
        details: v.optional(v.any()),
        roleId: v.optional(v.string()),
        runId: v.string(),
        status: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: actionRecordValidator,
    handler: async (ctx: RoleReconciliationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const runId = parseRunId(args.runId);

        await requireRoleReconciliationRun(ctx, runId);

        const document = unwrap(
            buildRoleReconciliationActionDocument(
                {
                    ...args,
                    runId,
                },
                new Date().toISOString()
            )
        );

        const id = await ctx.db.insert('roleReconciliationActions', document);

        return toRoleReconciliationActionRecord({ ...document, _id: id });
    },
});

export const listRoleReconciliationActionsByRunId = query({
    args: {
        limit: v.optional(v.number()),
        runId: v.string(),
        status: v.optional(v.string()),
    },
    returns: v.array(actionRecordValidator),
    handler: async (ctx: RoleReconciliationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReconciliationServices);
        const runId = parseRunId(args.runId);
        const status = args.status?.trim();
        const actions =
            status === undefined
                ? await ctx.db
                      .query('roleReconciliationActions')
                      .withIndex('by_run_created', (query) => query.eq('runId', runId))
                      .order('asc')
                      .take(normalizeLimit(args.limit))
                : await ctx.db
                      .query('roleReconciliationActions')
                      .withIndex('by_run_status', (query) => query.eq('runId', runId).eq('status', status))
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

async function findRoleReconciliationRunById(
    ctx: RoleReconciliationQueryCtx | RoleReconciliationMutationCtx,
    runId: GenericId<'roleReconciliationRuns'>
): Promise<StoredRoleReconciliationRunDocument | null> {
    return await ctx.db.get(runId);
}

async function requireRoleReconciliationRun(
    ctx: RoleReconciliationMutationCtx,
    runId: GenericId<'roleReconciliationRuns'>
): Promise<StoredRoleReconciliationRunDocument> {
    const run = await findRoleReconciliationRunById(ctx, runId);

    if (!run) {
        throw new Error('role-reconciliation-run-not-found');
    }

    return run;
}

function parseRunId(runId: string): GenericId<'roleReconciliationRuns'> {
    return unwrap(normalizeRequiredRunId(runId)) as GenericId<'roleReconciliationRuns'>;
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

function normalizeOptionalRecord(value: unknown): Record<string, unknown> | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (isObjectRecord(value)) return value;

    throw new Error('invalid-value');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
