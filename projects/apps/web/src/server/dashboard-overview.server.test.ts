import { loadGuildOverviewAggregate } from '@neonflux/db';
import type { GuildOverviewAggregate } from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { loadDashboardGuildOverview } from './dashboard-overview.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1');

vi.mock('./db.server.js', () => ({
    getWebDb: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-guild-page.server.js', () => ({
    loadDashboardGuildPageData: vi.fn(),
}));

vi.mock('@neonflux/db', () => ({
    loadGuildOverviewAggregate: vi.fn(),
}));

describe('loadDashboardGuildOverview', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });
        vi.mocked(loadGuildOverviewAggregate).mockResolvedValue(ok(createAggregate()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('denies unavailable or unauthorized guilds before reading aggregates', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        await expect(loadDashboardGuildOverview(request, 'guild-1')).resolves.toStrictEqual({ type: 'auth-required' });

        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(loadDashboardGuildOverview(request, 'guild-1')).resolves.toStrictEqual({ type: 'not-found' });
        expect(loadGuildOverviewAggregate).not.toHaveBeenCalled();
    });

    it('loads empty overview data safely through the authorized guild scope', async () => {
        const result = await loadDashboardGuildOverview(request, 'requested-guild');

        expect(result).toStrictEqual({
            type: 'overview',
            overview: createOverview(),
        });
        expect(loadGuildOverviewAggregate).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                days: 30,
            }
        );
    });

    it('serializes only observable member and message activity', async () => {
        vi.mocked(loadGuildOverviewAggregate).mockResolvedValueOnce(
            ok(
                createAggregate({
                    oldestRetainedActivityAt: new Date('2026-06-25T00:00:00.000Z'),
                    memberFlow: {
                        totalJoins: 3,
                        totalLeaves: 1,
                        netGrowth: 2,
                        graph: [
                            { date: '2026-06-25', joins: 2, leaves: 0, netGrowth: 2 },
                            { date: '2026-06-26', joins: 1, leaves: 1, netGrowth: 0 },
                        ],
                    },
                    messages: {
                        totalMessages: 12,
                        graph: [
                            { date: '2026-06-25', messageCount: 4 },
                            { date: '2026-06-26', messageCount: 8 },
                        ],
                    },
                    activityPresence: {
                        hasMemberFlow: true,
                        hasMessageActivity: true,
                    },
                })
            )
        );

        const result = await loadDashboardGuildOverview(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'overview',
            overview: {
                oldestRetainedActivityAt: '2026-06-25T00:00:00.000Z',
                windowDays: 30,
                activityPresence: {
                    hasMemberFlow: true,
                    hasMessageActivity: true,
                },
                memberFlow: {
                    totalJoins: 3,
                    totalLeaves: 1,
                    netGrowth: 2,
                    graph: [
                        { date: '2026-06-25', joins: 2, leaves: 0, netGrowth: 2 },
                        { date: '2026-06-26', joins: 1, leaves: 1, netGrowth: 0 },
                    ],
                },
                messages: {
                    totalMessages: 12,
                    graph: [
                        { date: '2026-06-25', messageCount: 4 },
                        { date: '2026-06-26', messageCount: 8 },
                    ],
                },
            },
        });
    });

    it('maps aggregate read failures to database-error', async () => {
        vi.mocked(loadGuildOverviewAggregate).mockResolvedValueOnce(err({ type: 'database-error' }));

        await expect(loadDashboardGuildOverview(request, 'guild-1')).resolves.toStrictEqual({ type: 'database-error' });
    });
});

function createAggregate(overrides: Partial<GuildOverviewAggregate> = {}): GuildOverviewAggregate {
    return {
        ...createOverviewAggregateShape(),
        ...overrides,
    };
}

function createOverviewAggregateShape(): GuildOverviewAggregate {
    return {
        activityPresence: {
            hasMemberFlow: false,
            hasMessageActivity: false,
        },
        windowDays: 30,
        memberFlow: {
            totalJoins: 0,
            totalLeaves: 0,
            netGrowth: 0,
            graph: [{ date: '2026-06-26', joins: 0, leaves: 0, netGrowth: 0 }],
        },
        messages: {
            totalMessages: 0,
            graph: [{ date: '2026-06-26', messageCount: 0 }],
        },
    };
}

function createOverview() {
    return {
        activityPresence: {
            hasMemberFlow: false,
            hasMessageActivity: false,
        },
        windowDays: 30,
        memberFlow: {
            totalJoins: 0,
            totalLeaves: 0,
            netGrowth: 0,
            graph: [{ date: '2026-06-26', joins: 0, leaves: 0, netGrowth: 0 }],
        },
        messages: {
            totalMessages: 0,
            graph: [{ date: '2026-06-26', messageCount: 0 }],
        },
    };
}
