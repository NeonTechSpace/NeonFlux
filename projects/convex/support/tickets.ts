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
    buildTicketDocument,
    buildTicketEventDocument,
    buildTicketMemberDocument,
    buildTicketPanelDocument,
    buildTicketStatusPatch,
    normalizeLimit,
    normalizeRequiredChannelId,
    normalizeRequiredGuildId,
    normalizeRequiredMessageId,
    normalizeRequiredOpenerUserId,
    normalizeRequiredPanelId,
    normalizeRequiredTicketId,
    toTicketEventRecord,
    toTicketMemberRecord,
    toTicketPanelRecord,
    toTicketRecord,
    type TicketDocument,
    type TicketEventDocument,
    type TicketMemberDocument,
    type TicketPanelDocument,
} from './tickets_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type TicketsQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type TicketsMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredTicketPanelDocument = TicketPanelDocument & { _id: GenericId<'ticketPanels'> };
type StoredTicketDocument = TicketDocument & { _id: GenericId<'tickets'> };
type StoredTicketMemberDocument = TicketMemberDocument & { _id: GenericId<'ticketMembers'> };

const allowedTicketServices = ['bot', 'web', 'migration'] as const;
const nullableString = v.union(v.string(), v.null());
const panelRecordValidator = v.object({
    channelId: v.string(),
    config: v.any(),
    createdAt: v.string(),
    enabled: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    messageId: nullableString,
    title: v.string(),
    updatedAt: v.string(),
});
const ticketRecordValidator = v.object({
    channelId: nullableString,
    claimedByUserId: nullableString,
    closedAt: nullableString,
    guildId: v.string(),
    id: v.string(),
    openedAt: v.string(),
    openerUserId: v.string(),
    panelId: nullableString,
    status: v.string(),
    ticketNumber: v.number(),
    updatedAt: v.string(),
});
const memberRecordValidator = v.object({
    createdAt: v.string(),
    id: v.string(),
    role: v.string(),
    ticketId: v.string(),
    userId: v.string(),
});
const eventRecordValidator = v.object({
    actorUserId: nullableString,
    createdAt: v.string(),
    details: v.any(),
    eventType: v.string(),
    id: v.string(),
    ticketId: v.string(),
});

export const createTicketPanel = mutationGeneric({
    args: {
        channelId: v.string(),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        messageId: v.optional(v.string()),
        title: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: panelRecordValidator,
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const document = unwrap(
            buildTicketPanelDocument({ ...args, guildId }, new Date().toISOString(), undefined, () =>
                crypto.randomUUID()
            )
        );

        await ctx.db.insert('ticketPanels', document);

        return toTicketPanelRecord(document);
    },
});

export const updateTicketPanel = mutationGeneric({
    args: {
        channelId: v.string(),
        config: v.optional(v.any()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        messageId: v.optional(v.string()),
        panelId: v.string(),
        title: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: v.union(panelRecordValidator, v.null()),
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const panel = await findTicketPanelByGuildLegacy(ctx, args);

        if (!panel) return null;

        const document = unwrap(
            buildTicketPanelDocument(
                {
                    ...args,
                    guildId: panel.guildId,
                    legacyId: panel.legacyId,
                },
                new Date().toISOString(),
                panel
            )
        );

        await ctx.db.patch(panel._id, {
            channelId: document.channelId,
            config: document.config,
            enabled: document.enabled,
            messageId: document.messageId,
            title: document.title,
            updatedAt: document.updatedAt,
        });

        return toTicketPanelRecord(document);
    },
});

export const listTicketPanelsByGuildId = queryGeneric({
    args: { enabledOnly: v.optional(v.boolean()), guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(panelRecordValidator),
    handler: async (ctx: TicketsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const panels = args.enabledOnly
            ? await ctx.db
                  .query('ticketPanels')
                  .withIndex('by_guild_enabled', (query) => query.eq('guildId', guildId).eq('enabled', true))
                  .order('asc')
                  .take(normalizeLimit(args.limit))
            : await ctx.db
                  .query('ticketPanels')
                  .withIndex('by_guild_created', (query) => query.eq('guildId', guildId))
                  .order('asc')
                  .take(normalizeLimit(args.limit));

        return panels.map(toTicketPanelRecord);
    },
});

export const findEnabledTicketPanelByMessageId = queryGeneric({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(panelRecordValidator, v.null()),
    handler: async (ctx: TicketsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const panels = await ctx.db
            .query('ticketPanels')
            .withIndex('by_guild_message', (query) => query.eq('guildId', guildId).eq('messageId', messageId))
            .filter((query) => query.eq(query.field('enabled'), true))
            .order('asc')
            .take(1);

        return panels[0] ? toTicketPanelRecord(panels[0]) : null;
    },
});

export const updateTicketPanelEnabled = mutationGeneric({
    args: { enabled: v.boolean(), guildId: v.string(), panelId: v.string() },
    returns: v.union(panelRecordValidator, v.null()),
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const panel = await findTicketPanelByGuildLegacy(ctx, args);

        if (!panel) return null;

        const updatedAt = new Date().toISOString();

        await ctx.db.patch(panel._id, { enabled: args.enabled, updatedAt });

        return toTicketPanelRecord({ ...panel, enabled: args.enabled, updatedAt });
    },
});

export const deleteTicketPanel = mutationGeneric({
    args: { guildId: v.string(), panelId: v.string() },
    returns: v.union(panelRecordValidator, v.null()),
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const panel = await findTicketPanelByGuildLegacy(ctx, args);

        if (!panel) return null;

        const tickets = await ctx.db
            .query('tickets')
            .withIndex('by_panel', (query) => query.eq('panelLegacyId', panel.legacyId))
            .take(500);

        for (const ticket of tickets) {
            await ctx.db.patch(ticket._id, { panelLegacyId: undefined });
        }

        await ctx.db.delete(panel._id);

        return toTicketPanelRecord(panel);
    },
});

export const reserveNextTicketNumber = mutationGeneric({
    args: { guildId: v.string() },
    returns: v.number(),
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const counter = await ctx.db
            .query('ticketCounters')
            .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
            .unique();
        const updatedAt = new Date().toISOString();

        if (!counter) {
            await ctx.db.insert('ticketCounters', { guildId, nextTicketNumber: 2, updatedAt });
            return 1;
        }

        await ctx.db.patch(counter._id, { nextTicketNumber: counter.nextTicketNumber + 1, updatedAt });

        return counter.nextTicketNumber;
    },
});

export const createTicket = mutationGeneric({
    args: {
        channelId: v.optional(v.string()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        openedAt: v.optional(v.string()),
        openerUserId: v.string(),
        panelId: v.optional(v.string()),
        ticketNumber: v.number(),
        updatedAt: v.optional(v.string()),
    },
    returns: ticketRecordValidator,
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        await requirePanelIfProvided(ctx, args.panelId);
        await requireTicketNumberAvailable(ctx, { guildId, ticketNumber: args.ticketNumber });

        const document = unwrap(
            buildTicketDocument({ ...args, guildId }, new Date().toISOString(), () => crypto.randomUUID())
        );

        await ctx.db.insert('tickets', document);

        return toTicketRecord(document);
    },
});

export const findOpenTicketByPanelAndOpener = queryGeneric({
    args: { openerUserId: v.string(), panelId: v.string() },
    returns: v.union(ticketRecordValidator, v.null()),
    handler: async (ctx: TicketsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const tickets = await listOpenTicketsByPanelOpener(ctx, { ...args, limit: 1 });

        return tickets[0] ? toTicketRecord(tickets[0]) : null;
    },
});

export const listOpenTicketsByPanelAndOpener = queryGeneric({
    args: { limit: v.optional(v.number()), openerUserId: v.string(), panelId: v.string() },
    returns: v.array(ticketRecordValidator),
    handler: async (ctx: TicketsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const tickets = await listOpenTicketsByPanelOpener(ctx, args);

        return tickets.map(toTicketRecord);
    },
});

export const findTicketByChannelId = queryGeneric({
    args: { channelId: v.string(), guildId: v.string() },
    returns: v.union(ticketRecordValidator, v.null()),
    handler: async (ctx: TicketsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const channelId = unwrap(normalizeRequiredChannelId(args.channelId));
        const tickets = await ctx.db
            .query('tickets')
            .withIndex('by_guild_channel', (query) => query.eq('guildId', guildId).eq('channelId', channelId))
            .order('asc')
            .take(1);

        return tickets[0] ? toTicketRecord(tickets[0]) : null;
    },
});

export const updateTicketChannelId = mutationGeneric({
    args: { channelId: v.string(), ticketId: v.string() },
    returns: v.union(ticketRecordValidator, v.null()),
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const ticket = await findTicketByLegacyId(ctx, args.ticketId);

        if (!ticket) return null;

        const channelId = unwrap(normalizeRequiredChannelId(args.channelId));
        const updatedAt = new Date().toISOString();

        await ctx.db.patch(ticket._id, { channelId, updatedAt });

        return toTicketRecord({ ...ticket, channelId, updatedAt });
    },
});

export const updateTicketStatus = mutationGeneric({
    args: { status: v.string(), ticketId: v.string(), updatedAt: v.optional(v.string()) },
    returns: v.union(ticketRecordValidator, v.null()),
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const ticket = await findTicketByLegacyId(ctx, args.ticketId);

        if (!ticket) return null;

        const patch = unwrap(buildTicketStatusPatch(ticket, args, new Date().toISOString()));

        await ctx.db.patch(ticket._id, patch);

        return toTicketRecord({ ...ticket, ...patch });
    },
});

export const addTicketMember = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        legacyId: v.optional(v.string()),
        role: v.optional(v.string()),
        ticketId: v.string(),
        userId: v.string(),
    },
    returns: memberRecordValidator,
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const ticketId = unwrap(normalizeRequiredTicketId(args.ticketId));

        await requireTicket(ctx, ticketId);

        const existingMember = await findTicketMemberByTicketUser(ctx, { ticketId, userId: args.userId });
        const document = unwrap(
            buildTicketMemberDocument({ ...args, ticketId }, new Date().toISOString(), existingMember ?? undefined)
        );

        if (existingMember) {
            await ctx.db.patch(existingMember._id, { role: document.role });
        } else {
            await ctx.db.insert('ticketMembers', document);
        }

        return toTicketMemberRecord(document);
    },
});

export const recordTicketEvent = mutationGeneric({
    args: {
        actorUserId: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        details: v.optional(v.any()),
        eventType: v.string(),
        legacyId: v.optional(v.string()),
        ticketId: v.string(),
    },
    returns: eventRecordValidator,
    handler: async (ctx: TicketsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedTicketServices);
        const ticketId = unwrap(normalizeRequiredTicketId(args.ticketId));

        await requireTicket(ctx, ticketId);

        const document = unwrap(
            buildTicketEventDocument({ ...args, ticketId }, new Date().toISOString(), () => crypto.randomUUID())
        );

        await ctx.db.insert('ticketEvents', document);

        return toTicketEventRecord(document);
    },
});

async function findTicketPanelByGuildLegacy(
    ctx: TicketsQueryCtx | TicketsMutationCtx,
    input: { guildId: string; panelId: string }
): Promise<StoredTicketPanelDocument | null> {
    const guildId = unwrap(normalizeRequiredGuildId(input.guildId));
    const panelId = unwrap(normalizeRequiredPanelId(input.panelId));
    const panel = await ctx.db
        .query('ticketPanels')
        .withIndex('by_legacy', (query) => query.eq('legacyId', panelId))
        .unique();

    return panel?.guildId === guildId ? panel : null;
}

async function findTicketByLegacyId(
    ctx: TicketsQueryCtx | TicketsMutationCtx,
    ticketId: string
): Promise<StoredTicketDocument | null> {
    const normalizedTicketId = unwrap(normalizeRequiredTicketId(ticketId));

    return await ctx.db
        .query('tickets')
        .withIndex('by_legacy', (query) => query.eq('legacyId', normalizedTicketId))
        .unique();
}

async function listOpenTicketsByPanelOpener(
    ctx: TicketsQueryCtx,
    input: { limit?: number; openerUserId: string; panelId: string }
): Promise<StoredTicketDocument[]> {
    const panelId = unwrap(normalizeRequiredPanelId(input.panelId));
    const openerUserId = unwrap(normalizeRequiredOpenerUserId(input.openerUserId));

    return await ctx.db
        .query('tickets')
        .withIndex('by_panel_opener_status_opened', (query) =>
            query.eq('panelLegacyId', panelId).eq('openerUserId', openerUserId).eq('status', 'open')
        )
        .order('asc')
        .take(normalizeLimit(input.limit, 10));
}

async function findTicketMemberByTicketUser(
    ctx: TicketsMutationCtx,
    input: { ticketId: string; userId: string }
): Promise<StoredTicketMemberDocument | null> {
    return await ctx.db
        .query('ticketMembers')
        .withIndex('by_ticket_user', (query) => query.eq('ticketLegacyId', input.ticketId).eq('userId', input.userId))
        .unique();
}

async function requireTicket(ctx: TicketsMutationCtx, ticketId: string): Promise<StoredTicketDocument> {
    const ticket = await findTicketByLegacyId(ctx, ticketId);

    if (!ticket) throw new Error('ticket-not-found');

    return ticket;
}

async function requirePanelIfProvided(ctx: TicketsMutationCtx, panelId: string | undefined): Promise<void> {
    if (!panelId) return;

    const panel = await ctx.db
        .query('ticketPanels')
        .withIndex('by_legacy', (query) => query.eq('legacyId', panelId.trim()))
        .unique();

    if (!panel) throw new Error('ticket-panel-not-found');
}

async function requireTicketNumberAvailable(
    ctx: TicketsMutationCtx,
    input: { guildId: string; ticketNumber: number }
): Promise<void> {
    const existing = await ctx.db
        .query('tickets')
        .withIndex('by_guild_ticket_number', (query) =>
            query.eq('guildId', input.guildId).eq('ticketNumber', input.ticketNumber)
        )
        .unique();

    if (existing) throw new Error('ticket-number-conflict');
}

async function requireGuildDocument(ctx: TicketsMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');

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
