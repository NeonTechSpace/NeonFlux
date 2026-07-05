import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    createTicketPanel,
    deleteTicketPanel,
    findEnabledTicketPanelByMessageId,
    listTicketPanelsByGuildId,
    reserveNextTicketNumber,
    updateTicketPanel,
    updateTicketPanelEnabled,
} from './runtime-tickets-panels.js';
import {
    addTicketMember,
    createTicket,
    findOpenTicketByPanelAndOpener,
    findTicketByChannelId,
    listOpenTicketsByPanelAndOpener,
    recordTicketEvent,
    updateTicketChannelId,
    updateTicketStatus,
} from './runtime-tickets.js';

const panel = {
    channelId: 'ticket-panel-channel-1',
    config: { openEmoji: '🎫' },
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    guildId: 'guild-1',
    id: 'ticket-panel-1',
    messageId: 'ticket-panel-message-1',
    title: 'Support tickets',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const ticket = {
    channelId: 'ticket-channel-1',
    claimedByUserId: null,
    closedAt: null,
    guildId: 'guild-1',
    id: 'ticket-1',
    openedAt: '2026-07-03T08:10:00.000Z',
    openerUserId: 'user-1',
    panelId: 'ticket-panel-1',
    status: 'open',
    ticketNumber: 7,
    updatedAt: '2026-07-03T09:10:00.000Z',
};
type TestTicketRecord = Omit<typeof ticket, 'closedAt'> & { closedAt: string | null };
const member = {
    createdAt: '2026-07-03T08:11:00.000Z',
    id: 'ticket-member-1',
    role: 'participant',
    ticketId: 'ticket-1',
    userId: 'user-1',
};
const event = {
    actorUserId: 'user-1',
    createdAt: '2026-07-03T08:12:00.000Z',
    details: { channelId: 'ticket-channel-1' },
    eventType: 'ticket.opened',
    id: 'ticket-event-1',
    ticketId: 'ticket-1',
};

describe('Convex tickets database functions', () => {
    it('routes ticket panel and counter operations through Convex', async () => {
        const disabledPanel = { ...panel, enabled: false };
        const db = createConvexDb({
            mutationResults: [panel, panel, disabledPanel, panel, 8],
            queryResults: [[panel], panel],
        });

        const created = await createTicketPanel(db, {
            channelId: ' ticket-panel-channel-1 ',
            config: panel.config,
            enabled: true,
            guildId: ' guild-1 ',
            messageId: ' ticket-panel-message-1 ',
            title: ' Support tickets ',
        });
        const updated = await updateTicketPanel(db, {
            channelId: ' ticket-panel-channel-1 ',
            config: panel.config,
            enabled: true,
            guildId: ' guild-1 ',
            messageId: ' ticket-panel-message-1 ',
            panelId: ' ticket-panel-1 ',
            title: ' Support tickets ',
        });
        const listed = await listTicketPanelsByGuildId(db, { enabledOnly: true, guildId: ' guild-1 ' });
        const found = await findEnabledTicketPanelByMessageId(db, {
            guildId: ' guild-1 ',
            messageId: ' ticket-panel-message-1 ',
        });
        const disabled = await updateTicketPanelEnabled(db, {
            enabled: false,
            guildId: ' guild-1 ',
            panelId: ' ticket-panel-1 ',
        });
        const deleted = await deleteTicketPanel(db, { guildId: ' guild-1 ', panelId: ' ticket-panel-1 ' });
        const nextNumber = await reserveNextTicketNumber(db, { guildId: ' guild-1 ' });

        expect(created._unsafeUnwrap()).toStrictEqual(toPanelRecord(panel));
        expect(updated._unsafeUnwrap()).toStrictEqual(toPanelRecord(panel));
        expect(listed._unsafeUnwrap()).toStrictEqual([toPanelRecord(panel)]);
        expect(found._unsafeUnwrap()).toStrictEqual(toPanelRecord(panel));
        expect(disabled._unsafeUnwrap()).toStrictEqual(toPanelRecord(disabledPanel));
        expect(deleted._unsafeUnwrap()).toStrictEqual(toPanelRecord(panel));
        expect(nextNumber._unsafeUnwrap()).toBe(8);
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            channelId: 'ticket-panel-channel-1',
            config: panel.config,
            enabled: true,
            guildId: 'guild-1',
            messageId: 'ticket-panel-message-1',
            title: 'Support tickets',
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            enabledOnly: true,
            guildId: 'guild-1',
            limit: 500,
        });
    });

    it('routes ticket workflow operations through Convex with Date conversion', async () => {
        const closedTicket = {
            ...ticket,
            closedAt: '2026-07-03T09:30:00.000Z',
            status: 'closed',
            updatedAt: '2026-07-03T09:30:00.000Z',
        };
        const db = createConvexDb({
            mutationResults: [ticket, { ...ticket, channelId: 'ticket-channel-2' }, closedTicket, member, event],
            queryResults: [ticket, [ticket], ticket],
        });

        const created = await createTicket(db, {
            channelId: ' ticket-channel-1 ',
            guildId: ' guild-1 ',
            openerUserId: ' user-1 ',
            panelId: ' ticket-panel-1 ',
            ticketNumber: 7,
        });
        const open = await findOpenTicketByPanelAndOpener(db, {
            openerUserId: ' user-1 ',
            panelId: ' ticket-panel-1 ',
        });
        const openList = await listOpenTicketsByPanelAndOpener(db, {
            limit: 3,
            openerUserId: ' user-1 ',
            panelId: ' ticket-panel-1 ',
        });
        const byChannel = await findTicketByChannelId(db, {
            channelId: ' ticket-channel-1 ',
            guildId: ' guild-1 ',
        });
        const moved = await updateTicketChannelId(db, {
            channelId: ' ticket-channel-2 ',
            ticketId: ' ticket-1 ',
        });
        const closed = await updateTicketStatus(db, {
            actorUserId: ' ignored-by-existing-contract ',
            status: ' closed ',
            ticketId: ' ticket-1 ',
        });
        const addedMember = await addTicketMember(db, {
            role: ' participant ',
            ticketId: ' ticket-1 ',
            userId: ' user-1 ',
        });
        const recordedEvent = await recordTicketEvent(db, {
            actorUserId: ' user-1 ',
            details: event.details,
            eventType: ' ticket.opened ',
            ticketId: ' ticket-1 ',
        });

        expect(created._unsafeUnwrap()).toStrictEqual(toTicketRecord(ticket));
        expect(open._unsafeUnwrap()).toStrictEqual(toTicketRecord(ticket));
        expect(openList._unsafeUnwrap()).toStrictEqual([toTicketRecord(ticket)]);
        expect(byChannel._unsafeUnwrap()).toStrictEqual(toTicketRecord(ticket));
        expect(moved._unsafeUnwrap()).toMatchObject({ channelId: 'ticket-channel-2' });
        expect(closed._unsafeUnwrap()).toStrictEqual(toTicketRecord(closedTicket));
        expect(addedMember._unsafeUnwrap()).toStrictEqual(toMemberRecord(member));
        expect(recordedEvent._unsafeUnwrap()).toStrictEqual(toEventRecord(event));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            channelId: 'ticket-channel-1',
            guildId: 'guild-1',
            openerUserId: 'user-1',
            panelId: 'ticket-panel-1',
            ticketNumber: 7,
        });
        expect(db.client.queryCalls[1]?.args).toStrictEqual({
            limit: 3,
            openerUserId: 'user-1',
            panelId: 'ticket-panel-1',
        });
    });

    it('maps validation and missing Convex records to existing repository errors', async () => {
        const db = createConvexDb({
            mutationResults: [null],
            queryResults: [null],
        });

        const missingTitle = await createTicketPanel(db, {
            channelId: 'ticket-panel-channel-1',
            guildId: 'guild-1',
            title: ' ',
        });
        const invalidNumber = await createTicket(db, {
            guildId: 'guild-1',
            openerUserId: 'user-1',
            ticketNumber: 0,
        });
        const invalidLimit = await listOpenTicketsByPanelAndOpener(db, {
            limit: 0,
            openerUserId: 'user-1',
            panelId: 'ticket-panel-1',
        });
        const missingPanel = await findEnabledTicketPanelByMessageId(db, {
            guildId: 'guild-1',
            messageId: 'ticket-panel-message-1',
        });
        const missingTicket = await updateTicketStatus(db, {
            status: 'closed',
            ticketId: 'ticket-1',
        });

        expect(missingTitle._unsafeUnwrapErr()).toStrictEqual({ field: 'title', type: 'missing-input' });
        expect(invalidNumber._unsafeUnwrapErr()).toStrictEqual({ field: 'ticketNumber', type: 'invalid-value' });
        expect(invalidLimit._unsafeUnwrapErr()).toStrictEqual({ field: 'limit', type: 'invalid-value' });
        expect(missingPanel._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingTicket._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });
});

function toPanelRecord(record: typeof panel) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toTicketRecord(record: TestTicketRecord) {
    return {
        ...record,
        closedAt: record.closedAt ? new Date(record.closedAt) : null,
        openedAt: new Date(record.openedAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toMemberRecord(record: typeof member) {
    return { ...record, createdAt: new Date(record.createdAt) };
}

function toEventRecord(record: typeof event) {
    return { ...record, createdAt: new Date(record.createdAt) };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(queryResults.shift());
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}
