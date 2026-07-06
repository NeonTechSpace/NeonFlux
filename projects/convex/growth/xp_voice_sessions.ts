import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildActiveXpVoiceSessionDocument,
    closeXpVoiceSessionDocument,
    normalizeRequiredChannelId,
    normalizeRequiredGuildId,
    normalizeRequiredUserId,
    toXpVoiceSessionRecord,
    type ClosedXpVoiceSessionDocument,
    type XpVoiceSessionDocument,
} from './xp_voice_sessions_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type XpVoiceQueryCtx = QueryCtx;
type XpVoiceMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredXpVoiceSessionDocument = XpVoiceSessionDocument & { _id: GenericId<'xpVoiceSessions'> };

const allowedXpVoiceServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const sessionRecordValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    creditedSeconds: v.number(),
    endedAt: nullableString,
    guildId: v.string(),
    id: v.string(),
    startedAt: v.string(),
    status: v.union(v.literal('active'), v.literal('closed')),
    updatedAt: v.string(),
    userId: v.string(),
});
const closedSessionValidator = v.object({
    durationSeconds: v.number(),
    session: sessionRecordValidator,
});
const transitionValidator = v.union(
    v.object({ active: sessionRecordValidator, status: v.literal('unchanged') }),
    v.object({
        active: sessionRecordValidator,
        closed: v.optional(closedSessionValidator),
        status: v.literal('started'),
    })
);

export const transitionXpVoiceSession = mutation({
    args: {
        channelId: v.string(),
        guildId: v.string(),
        occurredAt: v.optional(v.string()),
        userId: v.string(),
    },
    returns: transitionValidator,
    handler: async (ctx: XpVoiceMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpVoiceServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const channelId = unwrap(normalizeRequiredChannelId(args.channelId));

        await requireGuildDocument(ctx, guildId);

        const active = await findActiveXpVoiceSession(ctx, { guildId, userId });

        if (active?.channelId === channelId) {
            return { active: toXpVoiceSessionRecord(active), status: 'unchanged' as const };
        }

        let closed: ClosedXpVoiceSessionDocument | undefined;

        if (active) {
            closed = await closeStoredXpVoiceSession(ctx, active, args.occurredAt);
        }

        const started = await insertActiveXpVoiceSession(ctx, {
            channelId,
            guildId,
            startedAt: args.occurredAt,
            userId,
        });

        return {
            active: toXpVoiceSessionRecord(started),
            ...(closed === undefined ? {} : { closed: toClosedSessionRecord(closed) }),
            status: 'started' as const,
        };
    },
});

export const startXpVoiceSession = mutation({
    args: {
        channelId: v.string(),
        guildId: v.string(),
        startedAt: v.optional(v.string()),
        userId: v.string(),
    },
    returns: sessionRecordValidator,
    handler: async (ctx: XpVoiceMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpVoiceServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const channelId = unwrap(normalizeRequiredChannelId(args.channelId));

        await requireGuildDocument(ctx, guildId);

        const active = await findActiveXpVoiceSession(ctx, { guildId, userId });

        if (active?.channelId === channelId) {
            return toXpVoiceSessionRecord(active);
        }

        if (active) {
            await closeStoredXpVoiceSession(ctx, active, args.startedAt);
        }

        const started = await insertActiveXpVoiceSession(ctx, {
            channelId,
            guildId,
            startedAt: args.startedAt,
            userId,
        });

        return toXpVoiceSessionRecord(started);
    },
});

export const closeXpVoiceSession = mutation({
    args: { endedAt: v.optional(v.string()), guildId: v.string(), userId: v.string() },
    returns: v.union(closedSessionValidator, v.null()),
    handler: async (ctx: XpVoiceMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpVoiceServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const active = await findActiveXpVoiceSession(ctx, { guildId, userId });

        if (!active) return null;

        const closed = await closeStoredXpVoiceSession(ctx, active, args.endedAt);

        return toClosedSessionRecord(closed);
    },
});

export const findActiveXpVoiceSessionByGuildUser = query({
    args: { guildId: v.string(), userId: v.string() },
    returns: v.union(sessionRecordValidator, v.null()),
    handler: async (ctx: XpVoiceQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpVoiceServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const active = await findActiveXpVoiceSession(ctx, { guildId, userId });

        return active ? toXpVoiceSessionRecord(active) : null;
    },
});

export const listActiveXpVoiceSessionsByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(sessionRecordValidator),
    handler: async (ctx: XpVoiceQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedXpVoiceServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const rows = await ctx.db
            .query('xpVoiceSessions')
            .withIndex('by_guild_status_started', (query) => query.eq('guildId', guildId).eq('status', 'active'))
            .order('asc')
            .take(normalizeLimit(args.limit));

        return rows.map(toXpVoiceSessionRecord);
    },
});

async function insertActiveXpVoiceSession(
    ctx: XpVoiceMutationCtx,
    input: {
        channelId: string;
        guildId: string;
        startedAt?: string | undefined;
        userId: string;
    }
): Promise<StoredXpVoiceSessionDocument> {
    const document = unwrap(
        buildActiveXpVoiceSessionDocument(
            {
                channelId: input.channelId,
                guildId: input.guildId,
                ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
                userId: input.userId,
            },
            new Date().toISOString()
        )
    );
    const id = await ctx.db.insert('xpVoiceSessions', document);

    return { ...document, _id: id };
}

async function closeStoredXpVoiceSession(
    ctx: XpVoiceMutationCtx,
    active: StoredXpVoiceSessionDocument,
    endedAt: string | undefined
): Promise<ClosedXpVoiceSessionDocument> {
    const closed = unwrap(closeXpVoiceSessionDocument(active, endedAt));

    await ctx.db.patch(active._id, {
        creditedSeconds: closed.session.creditedSeconds,
        endedAt: closed.session.endedAt,
        status: closed.session.status,
        updatedAt: closed.session.updatedAt,
    });

    return closed;
}

async function findActiveXpVoiceSession(
    ctx: XpVoiceQueryCtx | XpVoiceMutationCtx,
    input: { guildId: string; userId: string }
): Promise<StoredXpVoiceSessionDocument | null> {
    return await ctx.db
        .query('xpVoiceSessions')
        .withIndex('by_guild_user_status', (query) =>
            query.eq('guildId', input.guildId).eq('userId', input.userId).eq('status', 'active')
        )
        .first();
}

async function requireGuildDocument(ctx: XpVoiceMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');

    return guild;
}

function toClosedSessionRecord(document: ClosedXpVoiceSessionDocument) {
    return {
        durationSeconds: document.durationSeconds,
        session: toXpVoiceSessionRecord(document.session),
    };
}

function normalizeLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) return 100;

    return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) throw new Error('invalid-input');

    return result.value;
}
