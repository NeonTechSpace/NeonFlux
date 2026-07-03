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
    buildGuildLoggingDestinationDocument,
    normalizeLoggingDestinationLimit,
    normalizeLoggingDestinationLookupInput,
    normalizeRequiredGuildId,
    serverLogEventGroups,
    toGuildLoggingDestinationRecord,
    type GuildLoggingDestinationDocument,
    type ServerLogEventGroup,
} from './logging_destinations_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type LoggingDestinationQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type LoggingDestinationMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = {
    _id: GenericId<'guilds'>;
    guildId: string;
};

type StoredGuildLoggingDestinationDocument = GuildLoggingDestinationDocument & {
    _id: GenericId<'guildLoggingDestinations'>;
};

const allowedLoggingDestinationServices = ['bot', 'web', 'migration'] as const;
const serverLogEventGroupValidator = v.union(
    v.literal('channels'),
    v.literal('members'),
    v.literal('messages'),
    v.literal('moderation'),
    v.literal('roles'),
    v.literal('voice')
);
const loggingDestinationRecordValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    enabled: v.boolean(),
    eventGroup: serverLogEventGroupValidator,
    guildId: v.string(),
    id: v.string(),
    updatedAt: v.string(),
});
const loggingDestinationIdentityArgs = {
    eventGroup: serverLogEventGroupValidator,
    guildId: v.string(),
};

export const readGuildLoggingDestinationByEventGroup = queryGeneric({
    args: loggingDestinationIdentityArgs,
    returns: v.union(loggingDestinationRecordValidator, v.null()),
    handler: async (ctx: LoggingDestinationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedLoggingDestinationServices);
        const lookup = unwrap(normalizeLoggingDestinationLookupInput(args));
        const destination = await findGuildLoggingDestinationDocument(ctx, lookup);

        return destination ? toGuildLoggingDestinationRecord(destination) : null;
    },
});

export const listGuildLoggingDestinationsByGuildId = queryGeneric({
    args: {
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(loggingDestinationRecordValidator),
    handler: async (ctx: LoggingDestinationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedLoggingDestinationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const destinations = await ctx.db
            .query('guildLoggingDestinations')
            .withIndex('by_guild_group', (query) => query.eq('guildId', guildId))
            .order('asc')
            .take(normalizeLoggingDestinationLimit(args.limit));

        return destinations
            .filter((destination) => args.enabled === undefined || destination.enabled === args.enabled)
            .map((destination) => toGuildLoggingDestinationRecord(toKnownEventGroupDocument(destination)));
    },
});

export const upsertGuildLoggingDestination = mutationGeneric({
    args: {
        ...loggingDestinationIdentityArgs,
        channelId: v.string(),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        legacyId: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: loggingDestinationRecordValidator,
    handler: async (ctx: LoggingDestinationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedLoggingDestinationServices);
        const lookup = unwrap(normalizeLoggingDestinationLookupInput(args));

        await requireGuildDocument(ctx, lookup.guildId);

        const existingDestination = await findGuildLoggingDestinationDocument(ctx, lookup);
        const document = unwrap(
            buildGuildLoggingDestinationDocument(
                {
                    ...args,
                    ...lookup,
                },
                new Date().toISOString(),
                existingDestination ?? undefined,
                () => crypto.randomUUID()
            )
        );

        if (existingDestination) {
            await ctx.db.patch(existingDestination._id, {
                channelId: document.channelId,
                enabled: document.enabled,
                updatedAt: document.updatedAt,
            });
        } else {
            await ctx.db.insert('guildLoggingDestinations', document);
        }

        return toGuildLoggingDestinationRecord(document);
    },
});

export const deleteGuildLoggingDestination = mutationGeneric({
    args: loggingDestinationIdentityArgs,
    returns: v.union(loggingDestinationRecordValidator, v.null()),
    handler: async (ctx: LoggingDestinationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedLoggingDestinationServices);
        const lookup = unwrap(normalizeLoggingDestinationLookupInput(args));
        const destination = await findGuildLoggingDestinationDocument(ctx, lookup);

        if (!destination) {
            return null;
        }

        await ctx.db.delete(destination._id);

        return toGuildLoggingDestinationRecord(destination);
    },
});

async function findGuildLoggingDestinationDocument(
    ctx: LoggingDestinationQueryCtx | LoggingDestinationMutationCtx,
    input: {
        eventGroup: ServerLogEventGroup;
        guildId: string;
    }
): Promise<StoredGuildLoggingDestinationDocument | null> {
    const destination = await ctx.db
        .query('guildLoggingDestinations')
        .withIndex('by_guild_group', (query) => query.eq('guildId', input.guildId).eq('eventGroup', input.eventGroup))
        .unique();

    return destination ? toKnownEventGroupDocument(destination) : null;
}

async function requireGuildDocument(ctx: LoggingDestinationMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function toKnownEventGroupDocument(
    document: Omit<StoredGuildLoggingDestinationDocument, 'eventGroup'> & { eventGroup: string }
): StoredGuildLoggingDestinationDocument {
    if (!serverLogEventGroups.includes(document.eventGroup as ServerLogEventGroup)) {
        throw new Error('invalid-server-log-event-group');
    }

    return {
        ...document,
        eventGroup: document.eventGroup as ServerLogEventGroup,
    };
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
