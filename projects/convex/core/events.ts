import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from './dashboard_live.js';
import { dashboardLiveAreasForBotActionFeature } from './dashboard_live_model.js';
import {
    botActionEventMatchesSearch,
    buildBotActionEventDocument,
    normalizeBotActionEventCursor,
    normalizeBotActionEventLimit,
    normalizeBotActionEventSearch,
    normalizeRequiredGuildId,
    toBotActionEventCursor,
    toBotActionEventRecord,
    type BotActionEventCursor,
    type BotActionEventDocument,
} from './events_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type EventsQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type EventsMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredBotActionEventDocument = BotActionEventDocument & {
    _id: GenericId<'botActionEvents'>;
};
type BotActionEventDocumentPage = {
    documents: StoredBotActionEventDocument[];
    nextCursor?: BotActionEventCursor;
};

const allowedEventServices = ['bot', 'web'] as const;
const searchScanLimit = 1000;

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
const botActionEventCursorValidator = v.object({
    createdAt: v.string(),
    id: v.string(),
});
const botActionEventPageValidator = v.object({
    nextCursor: v.optional(botActionEventCursorValidator),
    records: v.array(botActionEventRecordValidator),
});
const listByGuildArgs = {
    feature: v.optional(v.string()),
    guildId: v.string(),
    limit: v.optional(v.number()),
};

export const recordBotActionEvent = mutationGeneric({
    args: {
        action: v.string(),
        actorUserId: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        feature: v.string(),
        guildId: v.optional(v.union(v.string(), v.null())),
        legacyId: v.optional(v.string()),
        metadata: v.optional(v.any()),
        targetId: v.optional(v.string()),
    },
    returns: botActionEventRecordValidator,
    handler: async (ctx: EventsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedEventServices);
        const document = unwrap(buildBotActionEventDocument(args, new Date().toISOString(), () => crypto.randomUUID()));

        await ctx.db.insert('botActionEvents', document);
        if (document.guildId) {
            await markDashboardLiveAreasChangedInMutation(ctx, {
                areas: dashboardLiveAreasForBotActionFeature(document.feature),
                guildId: document.guildId,
                now: document.createdAt,
            });
        }

        return toBotActionEventRecord(document);
    },
});

export const listBotActionEventsByGuildId = queryGeneric({
    args: listByGuildArgs,
    returns: v.array(botActionEventRecordValidator),
    handler: async (ctx: EventsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedEventServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const feature = normalizeOptionalString(args.feature);
        const limit = normalizeBotActionEventLimit(args.limit);
        const documents = await takeBotActionEventDocumentsByGuild(ctx, {
            ...(feature ? { feature } : {}),
            guildId,
            limit,
        });

        return documents.map(toBotActionEventRecord);
    },
});

export const listBotActionEventPageByGuildId = queryGeneric({
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
                ? { nextCursor: toBotActionEventCursor(records.at(-1) ?? toBotActionEventRecord(extraDocument)) }
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

export const listBotActionEventsByFeaturePage = queryGeneric({
    args: {
        cursor: v.optional(botActionEventCursorValidator),
        feature: v.string(),
        limit: v.optional(v.number()),
    },
    returns: botActionEventPageValidator,
    handler: async (ctx: EventsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedEventServices);
        const feature = normalizeOptionalString(args.feature);

        if (!feature) {
            throw new Error('missing-feature');
        }

        const cursor = unwrap(normalizeBotActionEventCursor(args.cursor));
        const limit = normalizeBotActionEventLimit(args.limit);
        const documents = await takeBotActionEventDocumentsByFeature(ctx, {
            ...(cursor ? { cursor } : {}),
            feature,
            limit: limit + 1,
        });
        const records = documents.slice(0, limit).map(toBotActionEventRecord);
        const extraDocument = documents.at(limit);

        return {
            ...(extraDocument
                ? { nextCursor: toBotActionEventCursor(records.at(-1) ?? toBotActionEventRecord(extraDocument)) }
                : {}),
            records,
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
    const indexedQuery = input.feature
        ? ctx.db
              .query('botActionEvents')
              .withIndex('by_guild_feature_created_legacy', (query) =>
                  query.eq('guildId', input.guildId).eq('feature', input.feature ?? '')
              )
        : ctx.db
              .query('botActionEvents')
              .withIndex('by_guild_created_legacy', (query) => query.eq('guildId', input.guildId));
    const cursorScopedQuery = input.cursor
        ? indexedQuery.filter((query) =>
              query.or(
                  query.lt(query.field('createdAt'), input.cursor?.createdAt ?? ''),
                  query.and(
                      query.eq(query.field('createdAt'), input.cursor?.createdAt ?? ''),
                      query.lt(query.field('legacyId'), input.cursor?.id ?? '')
                  )
              )
          )
        : indexedQuery;

    return await cursorScopedQuery.order('desc').take(input.limit);
}

async function takeBotActionEventDocumentsByFeature(
    ctx: EventsQueryCtx,
    input: {
        cursor?: BotActionEventCursor;
        feature: string;
        limit: number;
    }
): Promise<StoredBotActionEventDocument[]> {
    const indexedQuery = ctx.db
        .query('botActionEvents')
        .withIndex('by_feature_created_legacy', (query) => query.eq('feature', input.feature));
    const cursorScopedQuery = input.cursor
        ? indexedQuery.filter((query) =>
              query.or(
                  query.lt(query.field('createdAt'), input.cursor?.createdAt ?? ''),
                  query.and(
                      query.eq(query.field('createdAt'), input.cursor?.createdAt ?? ''),
                      query.lt(query.field('legacyId'), input.cursor?.id ?? '')
                  )
              )
          )
        : indexedQuery;

    return await cursorScopedQuery.order('desc').take(input.limit);
}

function toBotActionEventDocumentCursor(document: BotActionEventDocument): BotActionEventCursor {
    return {
        createdAt: document.createdAt,
        id: document.legacyId,
    };
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
