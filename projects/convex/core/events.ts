import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from './dashboard_live.js';
import { dashboardLiveAreasForBotActionFeature } from './dashboard_live_model.js';
import {
    botActionEventMatchesSearch,
    buildBotActionEventSortKey,
    buildBotActionEventDocument,
    decodeBotActionEventCursor,
    encodeBotActionEventCursor,
    normalizeBotActionEventCursor,
    normalizeBotActionEventLimit,
    normalizeBotActionEventSearch,
    normalizeRequiredGuildId,
    toBotActionEventRecord,
    type BotActionEventCursor,
    type BotActionEventDocument,
} from './events_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type EventsQueryCtx = QueryCtx;
type EventsMutationCtx = MutationCtx;

type StoredBotActionEventDocument = BotActionEventDocument & {
    _creationTime: number;
    _id: GenericId<'botActionEvents'>;
};
type ResolvedBotActionEventCursor = {
    sortKey: string;
};
type BotActionEventDocumentPage = {
    documents: StoredBotActionEventDocument[];
    nextCursor?: BotActionEventCursor;
};

const allowedEventServices = ['bot', 'web'] as const;
const searchScanLimit = 1000;

export type BotActionEventMutationInput = {
    action: string;
    actorUserId?: string;
    createdAt?: string;
    feature: string;
    guildId?: string | null;
    metadata?: unknown;
    targetId?: string;
};

const botActionEventRecordValidator = v.object({
    action: v.string(),
    actorUserId: v.union(v.string(), v.null()),
    createdAt: v.string(),
    feature: v.string(),
    guildId: v.union(v.string(), v.null()),
    id: v.string(),
    metadata: v.any(),
    targetId: v.union(v.string(), v.null()),
});
const botActionEventCursorValidator = v.string();
const botActionEventPageValidator = v.object({
    nextCursor: v.optional(botActionEventCursorValidator),
    records: v.array(botActionEventRecordValidator),
});
const backfillBotActionEventSortKeysResultValidator = v.object({
    hasMore: v.boolean(),
    patchedCount: v.number(),
});
const listByGuildArgs = {
    feature: v.optional(v.string()),
    guildId: v.string(),
    limit: v.optional(v.number()),
};

export async function recordBotActionEventInMutation(ctx: EventsMutationCtx, input: BotActionEventMutationInput) {
    const document = unwrap(buildBotActionEventDocument(input, new Date().toISOString()));
    const id = await ctx.db.insert('botActionEvents', document);
    const sortKey = buildBotActionEventSortKey({ createdAt: document.createdAt, id });
    await ctx.db.patch('botActionEvents', id, { sortKey });

    if (document.guildId) {
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: dashboardLiveAreasForBotActionFeature(document.feature),
            guildId: document.guildId,
            now: document.createdAt,
        });
    }

    return toBotActionEventRecord({ ...document, _id: id, sortKey });
}

export const listBotActionEventPageByGuildId = query({
    args: {
        ...listByGuildArgs,
        cursor: v.optional(botActionEventCursorValidator),
        search: v.optional(v.string()),
        searchOffsetMinutes: v.optional(v.number()),
        searchScope: v.optional(v.string()),
    },
    returns: botActionEventPageValidator,
    handler: async (ctx: EventsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedEventServices);

        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const feature = normalizeOptionalString(args.feature);
        const cursor = unwrap(normalizeBotActionEventCursor(args.cursor));
        const limit = normalizeBotActionEventLimit(args.limit);
        const search = normalizeBotActionEventSearch({
            ...(args.search === undefined ? {} : { search: args.search }),
            ...(args.searchOffsetMinutes === undefined ? {} : { searchOffsetMinutes: args.searchOffsetMinutes }),
            ...(args.searchScope === undefined ? {} : { searchScope: args.searchScope }),
        });

        if (search.tokens.length > 0) {
            const page = await takeSearchedBotActionEventDocumentsByGuild(ctx, {
                ...(cursor ? { cursor } : {}),
                ...(feature ? { feature } : {}),
                guildId,
                limit,
                search,
            });

            return {
                ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
                records: page.documents.map(toBotActionEventRecord),
            };
        }

        const documents = await takeBotActionEventDocumentsByGuild(ctx, {
            ...(cursor ? { cursor } : {}),
            ...(feature ? { feature } : {}),
            guildId,
            limit: limit + 1,
        });
        const records = documents.slice(0, limit).map(toBotActionEventRecord);
        const extraDocument = documents.at(limit);

        return {
            ...(extraDocument
                ? { nextCursor: toBotActionEventDocumentCursor(documents[limit - 1] ?? extraDocument) }
                : {}),
            records,
        };
    },
});

async function takeSearchedBotActionEventDocumentsByGuild(
    ctx: EventsQueryCtx,
    input: Parameters<typeof takeBotActionEventDocumentsByGuild>[1] & {
        search: ReturnType<typeof normalizeBotActionEventSearch>;
    }
): Promise<BotActionEventDocumentPage> {
    const scannedDocuments = await takeBotActionEventDocumentsByGuild(ctx, {
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.feature ? { feature: input.feature } : {}),
        guildId: input.guildId,
        limit: searchScanLimit,
    });
    const matchedDocuments: StoredBotActionEventDocument[] = [];

    for (const document of scannedDocuments) {
        if (!botActionEventMatchesSearch(document, input.search)) {
            continue;
        }

        matchedDocuments.push(document);

        if (matchedDocuments.length > input.limit) {
            const lastReturnedDocument = matchedDocuments[input.limit - 1];

            return {
                documents: matchedDocuments.slice(0, input.limit),
                ...(lastReturnedDocument ? { nextCursor: toBotActionEventDocumentCursor(lastReturnedDocument) } : {}),
            };
        }
    }

    const lastScannedDocument = scannedDocuments.at(-1);
    const hasMoreScannableEvents = scannedDocuments.length >= searchScanLimit;

    return {
        documents: matchedDocuments,
        ...(hasMoreScannableEvents && lastScannedDocument
            ? { nextCursor: toBotActionEventDocumentCursor(lastScannedDocument) }
            : {}),
    };
}

export const backfillBotActionEventSortKeys = mutation({
    args: {
        limit: v.optional(v.number()),
    },
    returns: backfillBotActionEventSortKeysResultValidator,
    handler: async (ctx: EventsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedEventServices);
        const limit = normalizeBotActionEventLimit(args.limit);
        const documents = await ctx.db
            .query('botActionEvents')
            .withIndex('by_sort_key', (query) => query.eq('sortKey', undefined))
            .take(limit + 1);
        const page = documents.slice(0, limit);

        for (const document of page) {
            await ctx.db.patch('botActionEvents', document._id, {
                sortKey: buildBotActionEventSortKey({ createdAt: document.createdAt, id: document._id }),
            });
        }

        return {
            hasMore: documents.length > limit,
            patchedCount: page.length,
        };
    },
});

async function takeBotActionEventDocumentsByGuild(
    ctx: EventsQueryCtx,
    input: {
        cursor?: BotActionEventCursor;
        feature?: string;
        guildId: string;
        limit: number;
    }
): Promise<StoredBotActionEventDocument[]> {
    const cursor = input.cursor ? await resolveBotActionEventCursor(ctx, input.cursor) : undefined;

    return input.feature
        ? await ctx.db
              .query('botActionEvents')
              .withIndex('by_guild_feature_sort_key', (query) => {
                  const scopedQuery = query.eq('guildId', input.guildId).eq('feature', input.feature ?? '');
                  return cursor
                      ? scopedQuery.gt('sortKey', '').lt('sortKey', cursor.sortKey)
                      : scopedQuery.gt('sortKey', '');
              })
              .order('desc')
              .take(input.limit)
        : await ctx.db
              .query('botActionEvents')
              .withIndex('by_guild_sort_key', (query) => {
                  const scopedQuery = query.eq('guildId', input.guildId);
                  return cursor
                      ? scopedQuery.gt('sortKey', '').lt('sortKey', cursor.sortKey)
                      : scopedQuery.gt('sortKey', '');
              })
              .order('desc')
              .take(input.limit);
}

function toBotActionEventDocumentCursor(document: StoredBotActionEventDocument): BotActionEventCursor {
    return encodeBotActionEventCursor(
        document.sortKey ?? buildBotActionEventSortKey({ createdAt: document.createdAt, id: document._id })
    );
}

async function resolveBotActionEventCursor(
    ctx: EventsQueryCtx,
    cursor: BotActionEventCursor
): Promise<ResolvedBotActionEventCursor> {
    const decodedCursor = unwrap(decodeBotActionEventCursor(cursor));

    if (decodedCursor.sortKey) {
        return { sortKey: decodedCursor.sortKey };
    }

    const legacyCursor = decodedCursor.legacy;
    if (!legacyCursor) {
        throw new Error('invalid-cursor');
    }

    const document = await ctx.db.get('botActionEvents', parseBotActionEventId(legacyCursor.id));

    if (document?.createdAt !== legacyCursor.createdAt || !document.sortKey) {
        throw new Error('invalid-cursor');
    }

    return {
        sortKey: document.sortKey,
    };
}

function parseBotActionEventId(eventId: string | GenericId<'botActionEvents'>): GenericId<'botActionEvents'> {
    return eventId as GenericId<'botActionEvents'>;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: string; ok: false }): Value {
    if (!result.ok) {
        throw new Error(result.error);
    }

    return result.value;
}
