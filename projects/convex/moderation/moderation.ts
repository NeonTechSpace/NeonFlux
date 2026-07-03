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
    buildCaseStatusPatch,
    buildModerationCaseDocument,
    buildModerationCaseEventDocument,
    normalizeModerationListLimit,
    normalizeRequiredCaseId,
    normalizeRequiredGuildId,
    normalizeSinceTimestamp,
    toModerationCaseEventRecord,
    toModerationCaseRecord,
    type ModerationCaseDocument,
    type ModerationCaseEventDocument,
} from './moderation_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type ModerationQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type ModerationMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredModerationCaseDocument = ModerationCaseDocument & { _id: GenericId<'moderationCases'> };
type StoredModerationCaseEventDocument = ModerationCaseEventDocument & { _id: GenericId<'moderationCaseEvents'> };

const allowedModerationServices = ['bot', 'web', 'migration'] as const;
const targetTypeValidator = v.union(v.literal('channel'), v.literal('user'));
const moderationCaseRecordValidator = v.object({
    action: v.string(),
    actorUserId: v.union(v.string(), v.null()),
    caseNumber: v.number(),
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    reason: v.union(v.string(), v.null()),
    status: v.string(),
    targetChannelId: v.union(v.string(), v.null()),
    targetType: targetTypeValidator,
    targetUserId: v.union(v.string(), v.null()),
    updatedAt: v.string(),
});
const moderationCaseEventRecordValidator = v.object({
    actorUserId: v.union(v.string(), v.null()),
    caseId: v.string(),
    createdAt: v.string(),
    details: v.any(),
    eventType: v.string(),
    id: v.string(),
});
export const createModerationCase = mutationGeneric({
    args: {
        action: v.string(),
        actorUserId: v.optional(v.string()),
        caseNumber: v.optional(v.number()),
        createdAt: v.optional(v.string()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        reason: v.optional(v.string()),
        status: v.optional(v.string()),
        targetUserId: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: moderationCaseRecordValidator,
    handler: async (ctx: ModerationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const caseNumber = args.caseNumber ?? (await allocateModerationCaseNumber(ctx, guildId));

        await assertCaseNumberAvailable(ctx, { guildId, caseNumber });

        if (args.caseNumber !== undefined) {
            await advanceModerationCaseCounter(ctx, guildId, caseNumber + 1);
        }

        const document = unwrap(
            buildModerationCaseDocument(
                {
                    ...args,
                    caseNumber,
                    guildId,
                    targetType: 'user',
                },
                new Date().toISOString(),
                () => crypto.randomUUID()
            )
        );

        await ctx.db.insert('moderationCases', document);

        return toModerationCaseRecord(document);
    },
});

export const createChannelModerationCase = mutationGeneric({
    args: {
        action: v.string(),
        actorUserId: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        reason: v.optional(v.string()),
        targetChannelId: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: moderationCaseRecordValidator,
    handler: async (ctx: ModerationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const caseNumber = await allocateModerationCaseNumber(ctx, guildId);
        const document = unwrap(
            buildModerationCaseDocument(
                {
                    ...args,
                    caseNumber,
                    guildId,
                    targetType: 'channel',
                },
                new Date().toISOString(),
                () => crypto.randomUUID()
            )
        );

        await ctx.db.insert('moderationCases', document);

        return toModerationCaseRecord(document);
    },
});

export const createObservedModerationCase = mutationGeneric({
    args: {
        action: v.string(),
        createdAt: v.optional(v.string()),
        details: v.optional(v.any()),
        eventType: v.string(),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        targetUserId: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: moderationCaseRecordValidator,
    handler: async (ctx: ModerationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const now = new Date().toISOString();
        const caseNumber = await allocateModerationCaseNumber(ctx, guildId);
        const document = unwrap(
            buildModerationCaseDocument(
                {
                    ...args,
                    caseNumber,
                    guildId,
                    status: 'resolved',
                    targetType: 'user',
                },
                now,
                () => crypto.randomUUID()
            )
        );

        await ctx.db.insert('moderationCases', document);
        await insertModerationCaseEvent(ctx, {
            caseId: document.legacyId,
            details: args.details,
            eventType: args.eventType,
        });

        return toModerationCaseRecord(document);
    },
});

export const findModerationCaseByGuildCaseNumber = queryGeneric({
    args: { caseNumber: v.number(), guildId: v.string() },
    returns: v.union(moderationCaseRecordValidator, v.null()),
    handler: async (ctx: ModerationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const moderationCase = await findCaseByGuildCaseNumber(ctx, { guildId, caseNumber: args.caseNumber });

        return moderationCase ? toModerationCaseRecord(moderationCase) : null;
    },
});

export const listModerationCasesByGuildId = queryGeneric({
    args: {
        action: v.optional(v.string()),
        guildId: v.string(),
        limit: v.optional(v.number()),
        status: v.optional(v.string()),
        targetUserId: v.optional(v.string()),
    },
    returns: v.array(moderationCaseRecordValidator),
    handler: async (ctx: ModerationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const limit = normalizeModerationListLimit(args.limit, 5, 100);
        const cases = await ctx.db
            .query('moderationCases')
            .withIndex('by_guild_case_number', (query) => query.eq('guildId', guildId))
            .filter((query) =>
                query.and(
                    args.targetUserId
                        ? query.eq(query.field('targetUserId'), args.targetUserId.trim())
                        : query.neq(query.field('legacyId'), ''),
                    args.action
                        ? query.eq(query.field('action'), args.action.trim())
                        : query.neq(query.field('legacyId'), ''),
                    args.status
                        ? query.eq(query.field('status'), args.status.trim())
                        : query.neq(query.field('legacyId'), '')
                )
            )
            .order('desc')
            .take(limit);

        return cases.map(toModerationCaseRecord);
    },
});

export const findRecentModerationCaseByTargetAction = queryGeneric({
    args: {
        action: v.string(),
        guildId: v.string(),
        since: v.string(),
        statuses: v.optional(v.array(v.string())),
        targetUserId: v.string(),
    },
    returns: v.union(moderationCaseRecordValidator, v.null()),
    handler: async (ctx: ModerationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const since = unwrap(normalizeSinceTimestamp(args.since));
        const statuses = new Set(args.statuses?.map((status) => status.trim()).filter(Boolean) ?? []);
        const rows = await ctx.db
            .query('moderationCases')
            .withIndex('by_guild_target_action_created', (query) =>
                query
                    .eq('guildId', guildId)
                    .eq('targetUserId', args.targetUserId.trim())
                    .eq('action', args.action.trim())
                    .gte('createdAt', since)
            )
            .filter((query) =>
                statuses.size > 0
                    ? query.or(...[...statuses].map((status) => query.eq(query.field('status'), status)))
                    : query.neq(query.field('legacyId'), '')
            )
            .order('desc')
            .take(1);

        return rows[0] ? toModerationCaseRecord(rows[0]) : null;
    },
});

export const recordModerationCaseEvent = mutationGeneric({
    args: {
        actorUserId: v.optional(v.string()),
        caseId: v.string(),
        createdAt: v.optional(v.string()),
        details: v.optional(v.any()),
        eventType: v.string(),
        legacyId: v.optional(v.string()),
    },
    returns: moderationCaseEventRecordValidator,
    handler: async (ctx: ModerationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const event = await insertModerationCaseEvent(ctx, args);

        return toModerationCaseEventRecord(event);
    },
});

export const listModerationCaseEventsByCaseId = queryGeneric({
    args: { caseId: v.string(), eventType: v.optional(v.string()), limit: v.optional(v.number()) },
    returns: v.array(moderationCaseEventRecordValidator),
    handler: async (ctx: ModerationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const caseId = unwrap(normalizeRequiredCaseId(args.caseId));
        const limit = normalizeModerationListLimit(args.limit, 10, 25);
        const events = await ctx.db
            .query('moderationCaseEvents')
            .withIndex('by_case_created', (query) => query.eq('caseLegacyId', caseId))
            .filter((query) =>
                args.eventType
                    ? query.eq(query.field('eventType'), args.eventType.trim())
                    : query.neq(query.field('legacyId'), '')
            )
            .order('desc')
            .take(limit);

        return events.map(toModerationCaseEventRecord);
    },
});

export const updateModerationCaseStatus = mutationGeneric({
    args: { caseId: v.string(), status: v.string() },
    returns: v.union(moderationCaseRecordValidator, v.null()),
    handler: async (ctx: ModerationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const moderationCase = await findCaseByLegacyId(ctx, unwrap(normalizeRequiredCaseId(args.caseId)));

        if (!moderationCase) return null;

        const patch = unwrap(buildCaseStatusPatch(moderationCase.status, args.status, new Date().toISOString()));

        await ctx.db.patch(moderationCase._id, patch);

        return toModerationCaseRecord({ ...moderationCase, ...patch });
    },
});

export const updateModerationCaseReason = mutationGeneric({
    args: { actorUserId: v.optional(v.string()), caseId: v.string(), reason: v.string() },
    returns: v.union(moderationCaseRecordValidator, v.null()),
    handler: async (ctx: ModerationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const moderationCase = await findCaseByLegacyId(ctx, unwrap(normalizeRequiredCaseId(args.caseId)));

        if (!moderationCase) return null;

        const reason = args.reason.trim();
        if (!reason) throw new Error('missing-input');

        const patch = { reason, updatedAt: new Date().toISOString() };

        await ctx.db.patch(moderationCase._id, patch);
        await insertModerationCaseEvent(ctx, {
            caseId: moderationCase.legacyId,
            details: { reason },
            eventType: 'reason.updated',
            ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
        });

        return toModerationCaseRecord({ ...moderationCase, ...patch });
    },
});

export const voidModerationCase = mutationGeneric({
    args: { actorUserId: v.optional(v.string()), caseId: v.string(), reason: v.optional(v.string()) },
    returns: v.union(moderationCaseRecordValidator, v.null()),
    handler: async (ctx: ModerationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const moderationCase = await findCaseByLegacyId(ctx, unwrap(normalizeRequiredCaseId(args.caseId)));

        if (!moderationCase) return null;

        const patch = unwrap(buildCaseStatusPatch(moderationCase.status, 'void', new Date().toISOString()));

        await ctx.db.patch(moderationCase._id, patch);
        await insertModerationCaseEvent(ctx, {
            caseId: moderationCase.legacyId,
            details: { ...(args.reason?.trim() ? { reason: args.reason.trim() } : {}) },
            eventType: 'case.voided',
            ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
        });

        return toModerationCaseRecord({ ...moderationCase, ...patch });
    },
});

export const addModerationCaseNote = mutationGeneric({
    args: { actorUserId: v.optional(v.string()), caseId: v.string(), note: v.string() },
    returns: moderationCaseEventRecordValidator,
    handler: async (ctx: ModerationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const note = args.note.trim();

        if (!note) throw new Error('missing-input');

        const event = await insertModerationCaseEvent(ctx, {
            caseId: args.caseId,
            details: { note },
            eventType: 'note.added',
            ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
        });

        return toModerationCaseEventRecord(event);
    },
});

async function insertModerationCaseEvent(
    ctx: ModerationMutationCtx,
    input: {
        actorUserId?: string;
        caseId: string;
        createdAt?: string;
        details?: Record<string, unknown>;
        eventType: string;
        legacyId?: string;
    }
): Promise<StoredModerationCaseEventDocument> {
    const caseId = unwrap(normalizeRequiredCaseId(input.caseId));

    await requireModerationCaseLegacyId(ctx, caseId);

    const document = unwrap(buildModerationCaseEventDocument(input, new Date().toISOString()));
    const id = await ctx.db.insert('moderationCaseEvents', document);

    return { ...document, _id: id };
}

async function allocateModerationCaseNumber(ctx: ModerationMutationCtx, guildId: string): Promise<number> {
    const counter = await findCaseCounterByGuildId(ctx, guildId);
    const now = new Date().toISOString();

    if (!counter) {
        await ctx.db.insert('moderationCaseCounters', {
            guildId,
            nextCaseNumber: 2,
            updatedAt: now,
        });

        return 1;
    }

    await ctx.db.patch(counter._id, {
        nextCaseNumber: counter.nextCaseNumber + 1,
        updatedAt: now,
    });

    return counter.nextCaseNumber;
}

async function advanceModerationCaseCounter(
    ctx: ModerationMutationCtx,
    guildId: string,
    nextCaseNumber: number
): Promise<void> {
    const counter = await findCaseCounterByGuildId(ctx, guildId);
    const now = new Date().toISOString();

    if (!counter) {
        await ctx.db.insert('moderationCaseCounters', {
            guildId,
            nextCaseNumber,
            updatedAt: now,
        });
        return;
    }

    if (counter.nextCaseNumber < nextCaseNumber) {
        await ctx.db.patch(counter._id, {
            nextCaseNumber,
            updatedAt: now,
        });
    }
}

async function assertCaseNumberAvailable(
    ctx: ModerationQueryCtx | ModerationMutationCtx,
    input: { caseNumber: number; guildId: string }
): Promise<void> {
    const existing = await findCaseByGuildCaseNumber(ctx, input);

    if (existing) {
        throw new Error('database-error');
    }
}

async function findCaseByGuildCaseNumber(
    ctx: ModerationQueryCtx | ModerationMutationCtx,
    input: { caseNumber: number; guildId: string }
): Promise<StoredModerationCaseDocument | null> {
    return await ctx.db
        .query('moderationCases')
        .withIndex('by_guild_case_number', (query) =>
            query.eq('guildId', input.guildId).eq('caseNumber', input.caseNumber)
        )
        .unique();
}

async function findCaseByLegacyId(
    ctx: ModerationQueryCtx | ModerationMutationCtx,
    legacyId: string
): Promise<StoredModerationCaseDocument | null> {
    return await ctx.db
        .query('moderationCases')
        .withIndex('by_legacy', (query) => query.eq('legacyId', legacyId))
        .unique();
}

async function requireModerationCaseLegacyId(
    ctx: ModerationQueryCtx | ModerationMutationCtx,
    legacyId: string
): Promise<StoredModerationCaseDocument> {
    const moderationCase = await findCaseByLegacyId(ctx, legacyId);

    if (!moderationCase) {
        throw new Error('moderation-case-not-found');
    }

    return moderationCase;
}

async function findCaseCounterByGuildId(
    ctx: ModerationMutationCtx,
    guildId: string
): Promise<{
    _id: GenericId<'moderationCaseCounters'>;
    guildId: string;
    nextCaseNumber: number;
    updatedAt: string;
} | null> {
    return await ctx.db
        .query('moderationCaseCounters')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();
}

async function requireGuildDocument(ctx: ModerationMutationCtx, guildId: string): Promise<StoredGuildDocument> {
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
