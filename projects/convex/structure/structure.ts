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
    buildObservedEventStateDocument,
    buildStructureExportSnapshotDocument,
    buildStructureImportActionDocument,
    buildStructureImportRunDocument,
    buildStructureImportRunStatusPatch,
    normalizeLimit,
    normalizeRequiredGuildId,
    toStructureExportSnapshotRecord,
    toStructureImportActionRecord,
    toStructureImportRunRecord,
    toStructureObservedEventStateRecord,
    type StructureExportSnapshotDocument,
    type StructureImportActionDocument,
    type StructureImportRunDocument,
    type StructureObservedEventStateDocument,
} from './structure_model.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type StructureQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type StructureMutationCtx = GenericMutationCtx<NeonFluxDataModel>;
type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredExportSnapshotDocument = StructureExportSnapshotDocument & { _id: GenericId<'structureExportSnapshots'> };
type StoredImportRunDocument = StructureImportRunDocument & { _id: GenericId<'structureImportRuns'> };
type StoredImportActionDocument = StructureImportActionDocument & { _id: GenericId<'structureImportActions'> };
type StoredObservedEventDocument = StructureObservedEventStateDocument & { _id: GenericId<'guildFeatureSettings'> };

const allowedStructureServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const exportRecordValidator = v.object({
    createdAt: v.string(),
    createdByUserId: nullableString,
    guildId: v.string(),
    id: v.string(),
    snapshot: v.any(),
    source: v.string(),
});
const actionRecordValidator = v.object({
    actionType: v.string(),
    createdAt: v.string(),
    details: v.any(),
    id: v.string(),
    runId: v.string(),
    status: v.string(),
    targetId: nullableString,
    targetType: v.string(),
    updatedAt: v.string(),
});
const runRecordValidator = v.object({
    appliedAt: nullableString,
    confirmedAt: nullableString,
    createdAt: v.string(),
    createdByUserId: nullableString,
    guildId: v.string(),
    id: v.string(),
    plan: v.any(),
    sourceSnapshotId: nullableString,
    status: v.string(),
    updatedAt: v.string(),
});
const runWithActionsValidator = v.object({
    appliedAt: nullableString,
    confirmedAt: nullableString,
    createdAt: v.string(),
    createdByUserId: nullableString,
    guildId: v.string(),
    id: v.string(),
    plan: v.any(),
    sourceSnapshotId: nullableString,
    status: v.string(),
    updatedAt: v.string(),
    actions: v.array(actionRecordValidator),
});
const observedStateValidator = v.object({
    createdAt: v.optional(v.string()),
    guildId: v.string(),
    lastEventType: v.optional(v.string()),
    lastObservedAt: v.optional(v.string()),
    lastTargetId: v.optional(v.string()),
    lastTargetType: v.optional(v.string()),
    observedChangeCount: v.number(),
    updatedAt: v.optional(v.string()),
});

export const findStructureObservedEventStateByGuildId = queryGeneric({
    args: { guildId: v.string() },
    returns: observedStateValidator,
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const state = await findObservedEventDocument(ctx, guildId);

        return state ? toStructureObservedEventStateRecord(state) : { guildId, observedChangeCount: 0 };
    },
});

export const recordStructureObservedEvent = mutationGeneric({
    args: {
        eventType: v.string(),
        guildId: v.string(),
        targetId: v.optional(v.union(v.string(), v.null())),
        targetType: v.string(),
    },
    returns: observedStateValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existing = await findObservedEventDocument(ctx, guildId);
        const current = existing ? toStructureObservedEventStateRecord(existing) : { guildId, observedChangeCount: 0 };
        const document = unwrap(
            buildObservedEventStateDocument(
                { ...args, guildId },
                current,
                new Date().toISOString(),
                existing ?? undefined
            )
        );

        if (existing) {
            await ctx.db.patch(existing._id, {
                config: document.config,
                enabled: true,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('guildFeatureSettings', document);
        }

        return toStructureObservedEventStateRecord(document);
    },
});

export const createStructureExportSnapshot = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        createdByUserId: v.optional(v.union(v.string(), v.null())),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        snapshot: v.any(),
        source: v.optional(v.string()),
    },
    returns: exportRecordValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const document = unwrap(buildStructureExportSnapshotDocument({ ...args, guildId }, new Date().toISOString()));

        await ctx.db.insert('structureExportSnapshots', document);

        return toStructureExportSnapshotRecord(document);
    },
});

export const listStructureExportSnapshotsByGuildId = queryGeneric({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(exportRecordValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const snapshots = await ctx.db
            .query('structureExportSnapshots')
            .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
            .order('desc')
            .take(normalizeLimit(args.limit));

        return snapshots.map(toStructureExportSnapshotRecord);
    },
});

export const findStructureExportSnapshotByGuildId = queryGeneric({
    args: { guildId: v.string(), snapshotId: v.string() },
    returns: v.union(exportRecordValidator, v.null()),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const snapshot = await findSnapshotByLegacyId(ctx, args.snapshotId);

        return snapshot?.guildId === args.guildId ? toStructureExportSnapshotRecord(snapshot) : null;
    },
});

export const createStructureImportRun = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        createdByUserId: v.optional(v.union(v.string(), v.null())),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        plan: v.optional(v.any()),
        sourceSnapshotId: v.optional(v.union(v.string(), v.null())),
    },
    returns: runRecordValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        await requireSourceSnapshotIfProvided(ctx, { guildId, sourceSnapshotId: args.sourceSnapshotId });

        const document = unwrap(buildStructureImportRunDocument({ ...args, guildId }, new Date().toISOString()));

        await ctx.db.insert('structureImportRuns', document);

        return toStructureImportRunRecord(document);
    },
});

export const listStructureImportRunsByGuildId = queryGeneric({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(runWithActionsValidator),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const runs = await ctx.db
            .query('structureImportRuns')
            .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
            .order('desc')
            .take(normalizeLimit(args.limit));

        return await Promise.all(runs.map((run) => toRunWithActions(ctx, run)));
    },
});

export const findStructureImportRunByGuildId = queryGeneric({
    args: { guildId: v.string(), runId: v.string() },
    returns: v.union(runWithActionsValidator, v.null()),
    handler: async (ctx: StructureQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const run = await findRunByLegacyId(ctx, args.runId);

        return run?.guildId === args.guildId ? await toRunWithActions(ctx, run) : null;
    },
});

export const updateStructureImportRunStatus = mutationGeneric({
    args: { plan: v.optional(v.any()), runId: v.string(), status: v.string() },
    returns: v.union(runRecordValidator, v.null()),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const run = await findRunByLegacyId(ctx, args.runId);

        if (!run) return null;

        const patch = unwrap(buildStructureImportRunStatusPatch(run, args, new Date().toISOString()));

        await ctx.db.patch(run._id, patch);

        return toStructureImportRunRecord({ ...run, ...patch });
    },
});

export const recordStructureImportAction = mutationGeneric({
    args: {
        actionType: v.string(),
        details: v.optional(v.any()),
        legacyId: v.optional(v.string()),
        runId: v.string(),
        status: v.optional(v.string()),
        targetId: v.optional(v.union(v.string(), v.null())),
        targetType: v.string(),
    },
    returns: actionRecordValidator,
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);

        await requireRun(ctx, args.runId);

        const document = unwrap(buildStructureImportActionDocument(args, new Date().toISOString()));

        await ctx.db.insert('structureImportActions', document);

        return toStructureImportActionRecord(document);
    },
});

export const updateStructureImportActionStatus = mutationGeneric({
    args: { actionId: v.string(), details: v.optional(v.any()), status: v.string() },
    returns: v.union(actionRecordValidator, v.null()),
    handler: async (ctx: StructureMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedStructureServices);
        const action = await findActionByLegacyId(ctx, args.actionId);

        if (!action) return null;

        const details = isObjectRecord(args.details) ? args.details : action.details;
        const updatedAt = new Date().toISOString();

        await ctx.db.patch(action._id, { details, status: args.status, updatedAt });

        return toStructureImportActionRecord({ ...action, details, status: args.status, updatedAt });
    },
});

async function findObservedEventDocument(
    ctx: StructureQueryCtx | StructureMutationCtx,
    guildId: string
): Promise<StoredObservedEventDocument | null> {
    const row = await ctx.db
        .query('guildFeatureSettings')
        .withIndex('by_guild_feature', (query) => query.eq('guildId', guildId).eq('feature', 'import_export'))
        .unique();

    return row as StoredObservedEventDocument | null;
}

async function findSnapshotByLegacyId(
    ctx: StructureQueryCtx | StructureMutationCtx,
    snapshotId: string
): Promise<StoredExportSnapshotDocument | null> {
    return await ctx.db
        .query('structureExportSnapshots')
        .withIndex('by_legacy', (query) => query.eq('legacyId', unwrapRequiredString(snapshotId, 'snapshotId')))
        .unique();
}

async function findRunByLegacyId(
    ctx: StructureQueryCtx | StructureMutationCtx,
    runId: string
): Promise<StoredImportRunDocument | null> {
    return await ctx.db
        .query('structureImportRuns')
        .withIndex('by_legacy', (query) => query.eq('legacyId', unwrapRequiredString(runId, 'runId')))
        .unique();
}

async function findActionByLegacyId(
    ctx: StructureMutationCtx,
    actionId: string
): Promise<StoredImportActionDocument | null> {
    return await ctx.db
        .query('structureImportActions')
        .withIndex('by_legacy', (query) => query.eq('legacyId', unwrapRequiredString(actionId, 'actionId')))
        .unique();
}

async function listActionsByRunId(ctx: StructureQueryCtx, runId: string): Promise<StoredImportActionDocument[]> {
    return await ctx.db
        .query('structureImportActions')
        .withIndex('by_run_created', (query) => query.eq('runLegacyId', runId))
        .order('asc')
        .take(500);
}

async function toRunWithActions(ctx: StructureQueryCtx, run: StoredImportRunDocument) {
    const actions = await listActionsByRunId(ctx, run.legacyId);

    return {
        ...toStructureImportRunRecord(run),
        actions: actions.map(toStructureImportActionRecord),
    };
}

async function requireSourceSnapshotIfProvided(
    ctx: StructureMutationCtx,
    input: { guildId: string; sourceSnapshotId?: string | null | undefined }
): Promise<void> {
    const sourceSnapshotId = normalizeOptionalString(input.sourceSnapshotId);
    if (!sourceSnapshotId) return;

    const snapshot = await findSnapshotByLegacyId(ctx, sourceSnapshotId);
    if (snapshot?.guildId !== input.guildId) throw new Error('structure-export-snapshot-not-found');
}

async function requireRun(ctx: StructureMutationCtx, runId: string): Promise<StoredImportRunDocument> {
    const run = await findRunByLegacyId(ctx, runId);
    if (!run) throw new Error('structure-import-run-not-found');
    return run;
}

async function requireGuildDocument(ctx: StructureMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');
    return guild;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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
