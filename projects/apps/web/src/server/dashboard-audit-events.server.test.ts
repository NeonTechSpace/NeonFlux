import { listBotActionEventPageByGuildId } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { loadDashboardGuildAuditEventsPage } from './dashboard-audit-events.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1');

vi.mock('./db.server.js', () => ({
    getWebDb: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-guild-page.server.js', () => ({
    loadDashboardGuildPageData: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        listBotActionEventPageByGuildId: vi.fn(),
    };
});

describe('loadDashboardGuildAuditEventsPage', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });
        vi.mocked(listBotActionEventPageByGuildId).mockResolvedValue(
            ok({
                records: [createBotActionEventRecord()],
            })
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads stored actor snapshots only through the authorized guild scope', async () => {
        const result = await loadDashboardGuildAuditEventsPage(request, { guildId: 'requested-guild' });

        expect(result).toStrictEqual({
            type: 'events',
            auditEvents: [createDashboardAuditEvent()],
        });
        expect(listBotActionEventPageByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                limit: 40,
            }
        );
    });

    it('forwards bounded pagination and scoped search state', async () => {
        vi.mocked(listBotActionEventPageByGuildId).mockResolvedValueOnce(
            ok({
                records: [createBotActionEventRecord()],
                nextCursor: 'opaque-next-cursor',
            })
        );

        const result = await loadDashboardGuildAuditEventsPage(request, {
            guildId: 'guild-1',
            cursor: '2026-06-26T00:00:00.000Z|event-1',
            search: 'channel-1',
            searchScope: 'channel',
            searchOffsetMinutes: -120,
            limit: 25,
        });

        expect(result).toStrictEqual({
            type: 'events',
            auditEvents: [createDashboardAuditEvent()],
            nextCursor: 'opaque-next-cursor',
        });
        expect(listBotActionEventPageByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                cursor: '2026-06-26T00:00:00.000Z|event-1',
                limit: 25,
                search: 'channel-1',
                searchScope: 'channel',
                searchOffsetMinutes: -120,
            }
        );
    });

    it('stops before the event query when guild access is denied', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(loadDashboardGuildAuditEventsPage(request, { guildId: 'guild-1' })).resolves.toStrictEqual({
            type: 'not-found',
        });
        expect(listBotActionEventPageByGuildId).not.toHaveBeenCalled();
    });

    it('rejects oversized cursors before the event query', async () => {
        await expect(
            loadDashboardGuildAuditEventsPage(request, {
                guildId: 'guild-1',
                cursor: 'x'.repeat(1_025),
            })
        ).resolves.toStrictEqual({ type: 'database-error' });
        expect(listBotActionEventPageByGuildId).not.toHaveBeenCalled();
    });
});

function createBotActionEventRecord() {
    return {
        id: 'event-1',
        guildId: 'guild-1',
        feature: 'posting',
        action: 'message.sent',
        actorUserId: 'actor-1',
        targetId: 'message-1',
        metadata: {
            actorDisplayName: 'Neonsy',
            actorUsername: 'neonsy',
            channelId: 'channel-1',
            messageId: 'message-1',
            contentLength: 5,
            embedCount: 0,
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}

function createDashboardAuditEvent() {
    return {
        id: 'event-1',
        feature: 'posting',
        action: 'message.sent',
        actorUserId: 'actor-1',
        actorUsername: 'neonsy',
        actorDisplayName: 'Neonsy',
        targetId: 'message-1',
        metadata: {
            actorDisplayName: 'Neonsy',
            actorUsername: 'neonsy',
            channelId: 'channel-1',
            messageId: 'message-1',
            contentLength: 5,
            embedCount: 0,
            source: 'dashboard',
        },
        createdAt: '2026-06-26T00:00:00.000Z',
    };
}
