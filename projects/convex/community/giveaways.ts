import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildGiveawayDocument,
    buildGiveawayEntryDocument,
    buildGiveawayEventDocument,
    buildGiveawayStatusPatch,
    buildGiveawayWinnerDocument,
    normalizeGiveawayLimit,
    normalizeRequiredGiveawayId,
    normalizeRequiredGuildId,
    normalizeRequiredMessageId,
    toGiveawayEntryRecord,
    toGiveawayEventRecord,
    toGiveawayRecord,
    toGiveawayWinnerRecord,
    type GiveawayDocument,
    type GiveawayEntryDocument,
    type GiveawayWinnerDocument,
} from './giveaways_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type GiveawaysQueryCtx = QueryCtx;
type GiveawaysMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredGiveawayDocument = GiveawayDocument & { _id: GenericId<'giveaways'> };
type StoredGiveawayEntryDocument = GiveawayEntryDocument & { _id: GenericId<'giveawayEntries'> };
type StoredGiveawayWinnerDocument = GiveawayWinnerDocument & { _id: GenericId<'giveawayWinners'> };

const allowedGiveawayServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const giveawayRecordValidator = v.object({
    channelId: v.string(),
    closedAt: nullableString,
    closedByUserId: nullableString,
    config: v.any(),
    createdAt: v.string(),
    createdByUserId: nullableString,
    description: nullableString,
    endsAt: nullableString,
    entryEmoji: v.string(),
    guildId: v.string(),
    id: v.string(),
    messageId: nullableString,
    prize: v.string(),
    status: v.union(v.literal('active'), v.literal('cancelled'), v.literal('closed'), v.literal('draft')),
    title: v.string(),
    updatedAt: v.string(),
    winnerCount: v.number(),
});
const entryRecordValidator = v.object({
    enteredAt: v.string(),
    giveawayId: v.string(),
    id: v.string(),
    removedAt: nullableString,
    userId: v.string(),
});
const winnerRecordValidator = v.object({
    drawNumber: v.number(),
    giveawayId: v.string(),
    id: v.string(),
    selectedAt: v.string(),
    userId: v.string(),
});
const eventRecordValidator = v.object({
    actorUserId: nullableString,
    createdAt: v.string(),
    details: v.any(),
    eventType: v.string(),
    giveawayId: v.string(),
    id: v.string(),
});
const drawResultValidator = v.object({
    giveaway: giveawayRecordValidator,
    winners: v.array(winnerRecordValidator),
});

export const createGiveaway = mutation({
    args: {
        channelId: v.string(),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        createdByUserId: v.optional(v.string()),
        description: v.optional(v.string()),
        endsAt: v.optional(v.string()),
        entryEmoji: v.optional(v.string()),
        guildId: v.string(),
        messageId: v.optional(v.string()),
        prize: v.string(),
        status: v.optional(v.string()),
        title: v.string(),
        updatedAt: v.optional(v.string()),
        winnerCount: v.optional(v.number()),
    },
    returns: giveawayRecordValidator,
    handler: async (ctx: GiveawaysMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const document = unwrap(buildGiveawayDocument({ ...args, guildId }, new Date().toISOString()));

        const id = await ctx.db.insert('giveaways', document);

        return toGiveawayRecord({ ...document, _id: id });
    },
});

export const listGiveawaysByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(giveawayRecordValidator),
    handler: async (ctx: GiveawaysQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const giveaways = await ctx.db
            .query('giveaways')
            .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
            .order('desc')
            .take(normalizeGiveawayLimit(args.limit));

        return giveaways.map(toGiveawayRecord);
    },
});

export const findGiveawayById = query({
    args: { giveawayId: v.string(), guildId: v.string() },
    returns: v.union(giveawayRecordValidator, v.null()),
    handler: async (ctx: GiveawaysQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveaway = await findGiveawayByGuildId(ctx, args);

        return giveaway ? toGiveawayRecord(giveaway) : null;
    },
});

export const findActiveGiveawayByGuildMessageId = query({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(giveawayRecordValidator, v.null()),
    handler: async (ctx: GiveawaysQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const giveaways = await ctx.db
            .query('giveaways')
            .withIndex('by_guild_message', (query) => query.eq('guildId', guildId).eq('messageId', messageId))
            .filter((query) => query.eq(query.field('status'), 'active'))
            .take(1);

        return giveaways[0] ? toGiveawayRecord(giveaways[0]) : null;
    },
});

export const updateGiveawayStatus = mutation({
    args: { actorUserId: v.optional(v.string()), giveawayId: v.string(), guildId: v.string(), status: v.string() },
    returns: v.union(giveawayRecordValidator, v.null()),
    handler: async (ctx: GiveawaysMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveaway = await findGiveawayByGuildId(ctx, args);

        if (!giveaway) return null;

        const patch = unwrap(buildGiveawayStatusPatch(giveaway, args, new Date().toISOString()));

        await ctx.db.patch(giveaway._id, patch);

        return toGiveawayRecord({ ...giveaway, ...patch });
    },
});

export const upsertGiveawayEntry = mutation({
    args: {
        enteredAt: v.optional(v.string()),
        giveawayId: v.string(),
        userId: v.string(),
    },
    returns: entryRecordValidator,
    handler: async (ctx: GiveawaysMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveawayId = unwrap(normalizeRequiredGiveawayId(args.giveawayId));

        await requireGiveaway(ctx, parseGiveawayId(giveawayId));

        const existingEntry = await findGiveawayEntryByUser(ctx, { giveawayId, userId: args.userId });
        const document = unwrap(
            buildGiveawayEntryDocument({ ...args, giveawayId }, new Date().toISOString(), existingEntry ?? undefined)
        );

        if (existingEntry) {
            await ctx.db.patch(existingEntry._id, { removedAt: undefined });
            return toGiveawayEntryRecord({ ...document, _id: existingEntry._id });
        } else {
            const id = await ctx.db.insert('giveawayEntries', document);
            return toGiveawayEntryRecord({ ...document, _id: id });
        }
    },
});

export const removeGiveawayEntry = mutation({
    args: { giveawayId: v.string(), userId: v.string() },
    returns: v.union(entryRecordValidator, v.null()),
    handler: async (ctx: GiveawaysMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveawayId = unwrap(normalizeRequiredGiveawayId(args.giveawayId));
        const entry = await findGiveawayEntryByUser(ctx, { giveawayId, userId: args.userId });

        if (!entry || entry.removedAt) return null;

        const removedAt = new Date().toISOString();

        await ctx.db.patch(entry._id, { removedAt });

        return toGiveawayEntryRecord({ ...entry, removedAt });
    },
});

export const listActiveGiveawayEntries = query({
    args: { giveawayId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(entryRecordValidator),
    handler: async (ctx: GiveawaysQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveawayId = unwrap(normalizeRequiredGiveawayId(args.giveawayId));
        const entries = await listActiveEntryDocuments(ctx, giveawayId, args.limit);

        return entries.map(toGiveawayEntryRecord);
    },
});

export const listGiveawayWinners = query({
    args: { giveawayId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(winnerRecordValidator),
    handler: async (ctx: GiveawaysQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveawayId = unwrap(normalizeRequiredGiveawayId(args.giveawayId));
        const winners = await listWinnerDocuments(ctx, giveawayId, args.limit);

        return winners.map(toGiveawayWinnerRecord);
    },
});

export const drawGiveawayWinners = mutation({
    args: {
        actorUserId: v.optional(v.string()),
        giveawayId: v.string(),
        guildId: v.string(),
        reroll: v.optional(v.boolean()),
    },
    returns: drawResultValidator,
    handler: async (ctx: GiveawaysMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveaway = await findGiveawayByGuildId(ctx, args);

        if (!giveaway) throw new Error('giveaway-not-found');
        if (args.reroll && giveaway.status !== 'closed') {
            throw new Error('invalid-status-transition');
        }
        if (!args.reroll && giveaway.status === 'closed') {
            const winners = (await listWinnerDocuments(ctx, giveaway._id)).filter((winner) => winner.drawNumber === 1);

            return { giveaway: toGiveawayRecord(giveaway), winners: winners.map(toGiveawayWinnerRecord) };
        }
        if (!args.reroll && giveaway.status !== 'active') {
            throw new Error('invalid-status-transition');
        }

        const entries = await listActiveEntryDocuments(ctx, giveaway._id, 1000);
        const existingWinners = await listWinnerDocuments(ctx, giveaway._id);
        const drawNumber = args.reroll ? getNextDrawNumber(existingWinners) : 1;
        const excludedUserIds = args.reroll
            ? new Set(existingWinners.map((winner) => winner.userId))
            : new Set<string>();
        const winnerUserIds = pickWinnerUserIds(entries, giveaway.winnerCount, excludedUserIds);
        const now = new Date().toISOString();
        const winners: StoredGiveawayWinnerDocument[] = [];

        for (const userId of winnerUserIds) {
            const winner = unwrap(buildGiveawayWinnerDocument({ drawNumber, giveawayId: giveaway._id, userId }, now));

            const id = await ctx.db.insert('giveawayWinners', winner);
            winners.push({ ...winner, _id: id });
        }

        const event = unwrap(
            buildGiveawayEventDocument(
                {
                    ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
                    details: { drawNumber, winnerCount: winners.length },
                    eventType: args.reroll ? 'rerolled' : 'closed',
                    giveawayId: giveaway._id,
                },
                now
            )
        );

        await ctx.db.insert('giveawayEvents', event);

        if (args.reroll) {
            return { giveaway: toGiveawayRecord(giveaway), winners: winners.map(toGiveawayWinnerRecord) };
        }

        const patch = {
            closedAt: now,
            status: 'closed' as const,
            updatedAt: now,
            ...(args.actorUserId?.trim() ? { closedByUserId: args.actorUserId.trim() } : {}),
        };

        await ctx.db.patch(giveaway._id, patch);

        return { giveaway: toGiveawayRecord({ ...giveaway, ...patch }), winners: winners.map(toGiveawayWinnerRecord) };
    },
});

export const recordGiveawayEvent = mutation({
    args: {
        actorUserId: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        details: v.optional(v.any()),
        eventType: v.string(),
        giveawayId: v.string(),
    },
    returns: eventRecordValidator,
    handler: async (ctx: GiveawaysMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveawayId = unwrap(normalizeRequiredGiveawayId(args.giveawayId));

        await requireGiveaway(ctx, parseGiveawayId(giveawayId));

        const document = unwrap(buildGiveawayEventDocument({ ...args, giveawayId }, new Date().toISOString()));

        const id = await ctx.db.insert('giveawayEvents', document);

        return toGiveawayEventRecord({ ...document, _id: id });
    },
});

export const readGiveawayEntryCount = query({
    args: { giveawayId: v.string() },
    returns: v.number(),
    handler: async (ctx: GiveawaysQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveawayId = unwrap(normalizeRequiredGiveawayId(args.giveawayId));
        const entries = await listActiveEntryDocuments(ctx, giveawayId, 1000);

        return entries.length;
    },
});

export const readLatestGiveawayDrawNumber = query({
    args: { giveawayId: v.string() },
    returns: v.number(),
    handler: async (ctx: GiveawaysQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayServices);
        const giveawayId = unwrap(normalizeRequiredGiveawayId(args.giveawayId));
        const winners = await listWinnerDocuments(ctx, giveawayId);

        return Math.max(0, ...winners.map((winner) => winner.drawNumber));
    },
});

async function findGiveawayByGuildId(
    ctx: GiveawaysQueryCtx | GiveawaysMutationCtx,
    input: { giveawayId: string; guildId: string }
): Promise<StoredGiveawayDocument | null> {
    const guildId = unwrap(normalizeRequiredGuildId(input.guildId));
    const giveaway = await findGiveawayByIdDocument(ctx, parseGiveawayId(input.giveawayId));

    return giveaway?.guildId === guildId ? giveaway : null;
}

async function findGiveawayByIdDocument(
    ctx: GiveawaysQueryCtx | GiveawaysMutationCtx,
    giveawayId: GenericId<'giveaways'>
): Promise<StoredGiveawayDocument | null> {
    return await ctx.db.get(giveawayId);
}

async function findGiveawayEntryByUser(
    ctx: GiveawaysQueryCtx | GiveawaysMutationCtx,
    input: { giveawayId: string; userId: string }
): Promise<StoredGiveawayEntryDocument | null> {
    return await ctx.db
        .query('giveawayEntries')
        .withIndex('by_giveaway_user', (query) =>
            query.eq('giveawayId', parseGiveawayId(input.giveawayId)).eq('userId', input.userId.trim())
        )
        .unique();
}

async function listActiveEntryDocuments(
    ctx: GiveawaysQueryCtx | GiveawaysMutationCtx,
    giveawayId: string | GenericId<'giveaways'>,
    limit?: number
): Promise<StoredGiveawayEntryDocument[]> {
    return await ctx.db
        .query('giveawayEntries')
        .withIndex('by_giveaway_removed', (query) => query.eq('giveawayId', parseGiveawayId(giveawayId)))
        .filter((query) => query.eq(query.field('removedAt'), undefined))
        .order('asc')
        .take(normalizeGiveawayLimit(limit, 1000, 1000));
}

async function listWinnerDocuments(
    ctx: GiveawaysQueryCtx | GiveawaysMutationCtx,
    giveawayId: string | GenericId<'giveaways'>,
    limit?: number
): Promise<StoredGiveawayWinnerDocument[]> {
    const winners = await ctx.db
        .query('giveawayWinners')
        .withIndex('by_giveaway_draw', (query) => query.eq('giveawayId', parseGiveawayId(giveawayId)))
        .take(normalizeGiveawayLimit(limit, 500, 1000));

    return winners.sort(
        (left, right) => right.drawNumber - left.drawNumber || left.selectedAt.localeCompare(right.selectedAt)
    );
}

async function requireGiveaway(
    ctx: GiveawaysMutationCtx,
    giveawayId: GenericId<'giveaways'>
): Promise<StoredGiveawayDocument> {
    const giveaway = await findGiveawayByIdDocument(ctx, giveawayId);

    if (!giveaway) throw new Error('giveaway-not-found');

    return giveaway;
}

function parseGiveawayId(giveawayId: string | GenericId<'giveaways'>): GenericId<'giveaways'> {
    return unwrap(normalizeRequiredGiveawayId(giveawayId)) as GenericId<'giveaways'>;
}

async function requireGuildDocument(ctx: GiveawaysMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');

    return guild;
}

function pickWinnerUserIds(
    entries: readonly GiveawayEntryDocument[],
    winnerCount: number,
    excludedUserIds: ReadonlySet<string>
): string[] {
    const candidates = entries.map((entry) => entry.userId).filter((userId) => !excludedUserIds.has(userId));
    const winners: string[] = [];

    while (candidates.length > 0 && winners.length < winnerCount) {
        const [winner] = candidates.splice(randomIndex(candidates.length), 1);

        if (winner) winners.push(winner);
    }

    return winners;
}

function randomIndex(length: number): number {
    const values = new Uint32Array(1);

    crypto.getRandomValues(values);

    return (values[0] ?? 0) % length;
}

function getNextDrawNumber(winners: readonly GiveawayWinnerDocument[]): number {
    return Math.max(0, ...winners.map((winner) => winner.drawNumber)) + 1;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;

        if (typeof error === 'object' && error !== null && 'type' in error) throw new Error(String(error.type));

        throw new Error(String(error));
    }

    return result.value;
}
