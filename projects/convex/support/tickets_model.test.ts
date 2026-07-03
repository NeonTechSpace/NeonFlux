import { describe, expect, it } from 'vitest';

import {
    buildTicketDocument,
    buildTicketEventDocument,
    buildTicketMemberDocument,
    buildTicketPanelDocument,
    buildTicketStatusPatch,
    toTicketEventRecord,
    toTicketMemberRecord,
    toTicketPanelRecord,
    toTicketRecord,
} from './tickets_model.js';

const now = '2026-07-03T08:00:00.000Z';
const createLegacyId = (): string => 'legacy-1';

describe('tickets model', () => {
    it('builds ticket panels with default enabled state and nullable message ids', () => {
        const result = buildTicketPanelDocument(
            {
                channelId: ' channel-1 ',
                config: { ticketCategoryId: 'category-1' },
                guildId: ' guild-1 ',
                title: ' Support tickets ',
            },
            now,
            undefined,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toTicketPanelRecord(result.value)).toStrictEqual({
            channelId: 'channel-1',
            config: { ticketCategoryId: 'category-1' },
            createdAt: now,
            enabled: true,
            guildId: 'guild-1',
            id: 'legacy-1',
            messageId: null,
            title: 'Support tickets',
            updatedAt: now,
        });
    });

    it('builds tickets with app-facing nullable fields', () => {
        const result = buildTicketDocument(
            {
                channelId: ' ticket-channel-1 ',
                guildId: ' guild-1 ',
                openerUserId: ' user-1 ',
                panelId: ' panel-1 ',
                ticketNumber: 1,
            },
            now,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toTicketRecord(result.value)).toStrictEqual({
            channelId: 'ticket-channel-1',
            claimedByUserId: null,
            closedAt: null,
            guildId: 'guild-1',
            id: 'legacy-1',
            openedAt: now,
            openerUserId: 'user-1',
            panelId: 'panel-1',
            status: 'open',
            ticketNumber: 1,
            updatedAt: now,
        });
    });

    it('enforces positive ticket numbers and ticket status transitions', () => {
        expect(
            buildTicketDocument(
                {
                    guildId: 'guild-1',
                    openerUserId: 'user-1',
                    ticketNumber: 0,
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'ticketNumber', type: 'invalid-value' },
            ok: false,
        });
        expect(buildTicketStatusPatch({ status: 'closed' }, { status: 'open' }, now)).toStrictEqual({
            error: { from: 'closed', to: 'open', type: 'invalid-status-transition' },
            ok: false,
        });
        expect(buildTicketStatusPatch({ status: 'open' }, { status: 'closed' }, now)).toStrictEqual({
            ok: true,
            value: { closedAt: now, status: 'closed', updatedAt: now },
        });
    });

    it('builds ticket members and events', () => {
        const member = buildTicketMemberDocument(
            {
                ticketId: ' ticket-1 ',
                userId: ' user-1 ',
            },
            now,
            undefined,
            createLegacyId
        );
        const event = buildTicketEventDocument(
            {
                actorUserId: ' user-1 ',
                details: { channelId: 'channel-1' },
                eventType: ' opened ',
                ticketId: ' ticket-1 ',
            },
            now,
            createLegacyId
        );

        expect(member.ok).toBe(true);
        expect(event.ok).toBe(true);
        if (!member.ok || !event.ok) return;
        expect(toTicketMemberRecord(member.value)).toStrictEqual({
            createdAt: now,
            id: 'legacy-1',
            role: 'participant',
            ticketId: 'ticket-1',
            userId: 'user-1',
        });
        expect(toTicketEventRecord(event.value)).toStrictEqual({
            actorUserId: 'user-1',
            createdAt: now,
            details: { channelId: 'channel-1' },
            eventType: 'opened',
            id: 'legacy-1',
            ticketId: 'ticket-1',
        });
    });
});
