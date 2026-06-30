import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import {
    addTicketMember,
    createTicket,
    createTicketPanel,
    deleteTicketPanel,
    findEnabledTicketPanelByMessageId,
    findOpenTicketByPanelAndOpener,
    findTicketByChannelId,
    listOpenTicketsByPanelAndOpener,
    listTicketPanelsByGuildId,
    recordTicketEvent,
    reserveNextTicketNumber,
    updateTicketChannelId,
    updateTicketPanelEnabled,
    updateTicketPanel,
    updateTicketStatus,
} from './tickets.js';

let testDatabase: TestDatabase | undefined;

beforeAll(async () => {
    testDatabase = await createTestDatabase();
});

beforeEach(async () => {
    await resetTestDatabase();
});

afterAll(async () => {
    await testDatabase?.close();
    testDatabase = undefined;
});

describe('tickets repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    it('creates, lists, finds, disables, and deletes ticket panels by guild', async () => {
        const panel = await expectOk(
            createTicketPanel(getDb(), {
                guildId: 'guild-1',
                channelId: 'panel-channel-1',
                messageId: 'panel-message-1',
                title: 'Support tickets',
                config: {
                    categoryId: 'category-1',
                    supportRoleIds: ['role-support'],
                },
            })
        );
        await expectOk(
            createTicketPanel(getDb(), {
                guildId: 'guild-2',
                channelId: 'panel-channel-2',
                messageId: 'panel-message-2',
                title: 'Other tickets',
            })
        );

        const panels = await expectOk(listTicketPanelsByGuildId(getDb(), { guildId: 'guild-1' }));
        const found = await expectOk(
            findEnabledTicketPanelByMessageId(getDb(), {
                guildId: 'guild-1',
                messageId: 'panel-message-1',
            })
        );
        const updated = await expectOk(
            updateTicketPanel(getDb(), {
                guildId: 'guild-1',
                panelId: panel.id,
                channelId: 'panel-channel-1',
                messageId: 'panel-message-3',
                title: 'Support desk',
                enabled: true,
                config: { ticketNameTemplate: 'help-{number}' },
            })
        );
        const disabled = await expectOk(
            updateTicketPanelEnabled(getDb(), {
                guildId: 'guild-1',
                panelId: panel.id,
                enabled: false,
            })
        );
        const enabledOnly = await findEnabledTicketPanelByMessageId(getDb(), {
            guildId: 'guild-1',
            messageId: 'panel-message-1',
        });
        const deleted = await expectOk(
            deleteTicketPanel(getDb(), {
                guildId: 'guild-1',
                panelId: panel.id,
            })
        );

        expect(panels).toHaveLength(1);
        expect(found.id).toBe(panel.id);
        expect(found.config).toStrictEqual({
            categoryId: 'category-1',
            supportRoleIds: ['role-support'],
        });
        expect(updated).toMatchObject({
            id: panel.id,
            title: 'Support desk',
            messageId: 'panel-message-3',
            config: { ticketNameTemplate: 'help-{number}' },
        });
        expect(disabled.enabled).toBe(false);
        expect(enabledOnly._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(deleted.id).toBe(panel.id);
    });

    it('reserves monotonic ticket numbers and records ticket lifecycle data', async () => {
        const panel = await createPanel();
        const firstNumber = await expectOk(reserveNextTicketNumber(getDb(), { guildId: 'guild-1' }));
        const secondNumber = await expectOk(reserveNextTicketNumber(getDb(), { guildId: 'guild-1' }));
        const otherGuildNumber = await expectOk(reserveNextTicketNumber(getDb(), { guildId: 'guild-2' }));
        const ticket = await expectOk(
            createTicket(getDb(), {
                guildId: 'guild-1',
                panelId: panel.id,
                channelId: 'ticket-channel-1',
                openerUserId: 'user-1',
                ticketNumber: firstNumber,
            })
        );
        const member = await expectOk(
            addTicketMember(getDb(), {
                ticketId: ticket.id,
                userId: 'user-1',
                role: 'opener',
            })
        );
        const event = await expectOk(
            recordTicketEvent(getDb(), {
                ticketId: ticket.id,
                eventType: 'opened',
                actorUserId: 'user-1',
                details: { channelId: 'ticket-channel-1' },
            })
        );
        const openTicket = await expectOk(
            findOpenTicketByPanelAndOpener(getDb(), {
                panelId: panel.id,
                openerUserId: 'user-1',
            })
        );
        const openTickets = await expectOk(
            listOpenTicketsByPanelAndOpener(getDb(), {
                panelId: panel.id,
                openerUserId: 'user-1',
            })
        );
        const byChannel = await expectOk(
            findTicketByChannelId(getDb(), {
                guildId: 'guild-1',
                channelId: 'ticket-channel-1',
            })
        );
        const moved = await expectOk(
            updateTicketChannelId(getDb(), {
                ticketId: ticket.id,
                channelId: 'ticket-channel-2',
            })
        );
        const closed = await expectOk(
            updateTicketStatus(getDb(), {
                ticketId: ticket.id,
                status: 'closed',
                actorUserId: 'user-1',
            })
        );
        const archived = await expectOk(
            updateTicketStatus(getDb(), {
                ticketId: ticket.id,
                status: 'archived',
                actorUserId: 'user-1',
            })
        );

        expect(firstNumber).toBe(1);
        expect(secondNumber).toBe(2);
        expect(otherGuildNumber).toBe(1);
        expect(member.role).toBe('opener');
        expect(event.details).toStrictEqual({ channelId: 'ticket-channel-1' });
        expect(openTicket.id).toBe(ticket.id);
        expect(openTickets).toHaveLength(1);
        expect(byChannel.id).toBe(ticket.id);
        expect(moved.channelId).toBe('ticket-channel-2');
        expect(closed.closedAt).toBeInstanceOf(Date);
        expect(archived.status).toBe('archived');
        expect(archived.closedAt).toBeInstanceOf(Date);
    });

    it('rejects invalid ticket input and illegal status transitions', async () => {
        const missingPanel = await createTicketPanel(getDb(), {
            guildId: '',
            channelId: 'panel-channel-1',
            title: 'Support tickets',
        });
        const invalidTicketNumber = await createTicket(getDb(), {
            guildId: 'guild-1',
            openerUserId: 'user-1',
            ticketNumber: 0,
        });
        const panel = await createPanel();
        const ticket = await expectOk(
            createTicket(getDb(), {
                guildId: 'guild-1',
                panelId: panel.id,
                openerUserId: 'user-1',
                ticketNumber: 1,
            })
        );
        await expectOk(updateTicketStatus(getDb(), { ticketId: ticket.id, status: 'closed' }));
        const reopen = await updateTicketStatus(getDb(), { ticketId: ticket.id, status: 'open' });

        expect(missingPanel._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'guildId' });
        expect(invalidTicketNumber._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'ticketNumber',
        });
        expect(reopen._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-status-transition',
            from: 'closed',
            to: 'open',
        });
    });
});

async function createPanel() {
    return expectOk(
        createTicketPanel(getDb(), {
            guildId: 'guild-1',
            channelId: 'panel-channel-1',
            messageId: 'panel-message-1',
            title: 'Support tickets',
        })
    );
}

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('tickets');
}

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb() {
    if (!testDatabase) {
        throw new Error('Test database was not created.');
    }

    return testDatabase.db;
}

async function expectOk<T>(resultPromise: Promise<{ isOk(): boolean; _unsafeUnwrap(): T }>): Promise<T> {
    const result = await resultPromise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

type TestDatabase = PgliteTestDatabase;
