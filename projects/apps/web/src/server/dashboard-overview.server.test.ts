import { loadGuildOverviewAggregate } from '@neonflux/db';
import type { GuildOverviewAggregate } from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { loadDashboardGuildOverview } from './dashboard-overview.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1');

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
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

    it('serializes populated graph, invite, and message overview data', async () => {
        vi.mocked(loadGuildOverviewAggregate).mockResolvedValueOnce(
            ok(
                createAggregate({
                    trackingStartedAt: new Date('2026-06-25T00:00:00.000Z'),
                    memberFlow: {
                        totalJoins: 3,
                        totalLeaves: 1,
                        netGrowth: 2,
                        graph: [
                            { date: '2026-06-25', joins: 2, leaves: 0, netGrowth: 2 },
                            { date: '2026-06-26', joins: 1, leaves: 1, netGrowth: 0 },
                        ],
                    },
                    invites: {
                        activeInviteCount: 2,
                        totalInviteUses: 8,
                        attribution: {
                            attributed: 2,
                            'baseline-missing': 1,
                            ambiguous: 0,
                            unavailable: 0,
                            'not-applicable': 1,
                        },
                        topInviters: [
                            {
                                inviterUserId: 'inviter-1',
                                attributedJoins: 2,
                                inviteCodes: [
                                    { code: 'alpha', uses: 5, active: true },
                                    { code: 'beta', uses: 3, active: true },
                                ],
                            },
                        ],
                    },
                    messages: {
                        totalMessages: 12,
                        graph: [
                            { date: '2026-06-25', messageCount: 4 },
                            { date: '2026-06-26', messageCount: 8 },
                        ],
                        topChannels: [{ channelId: 'channel-1', messageCount: 12 }],
                    },
                    dataHealth: {
                        hasMemberFlow: true,
                        hasInviteSnapshots: true,
                        hasMessageActivity: true,
                    },
                })
            )
        );

        const result = await loadDashboardGuildOverview(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'overview',
            overview: {
                trackingStartedAt: '2026-06-25T00:00:00.000Z',
                memberFlow: {
                    totalJoins: 3,
                    totalLeaves: 1,
                    netGrowth: 2,
                    graph: [
                        { date: '2026-06-25', joins: 2, leaves: 0, netGrowth: 2 },
                        { date: '2026-06-26', joins: 1, leaves: 1, netGrowth: 0 },
                    ],
                },
                invites: {
                    activeInviteCount: 2,
                    totalInviteUses: 8,
                    attribution: {
                        attributed: 2,
                        baselineMissing: 1,
                        ambiguous: 0,
                        unavailable: 0,
                        notApplicable: 1,
                    },
                    topInviters: [
                        {
                            inviterUserId: 'inviter-1',
                            attributedJoins: 2,
                            inviteCodes: [
                                { code: 'alpha', uses: 5, active: true },
                                { code: 'beta', uses: 3, active: true },
                            ],
                        },
                    ],
                },
                messages: {
                    totalMessages: 12,
                    graph: [
                        { date: '2026-06-25', messageCount: 4 },
                        { date: '2026-06-26', messageCount: 8 },
                    ],
                    topChannels: [{ channelId: 'channel-1', messageCount: 12 }],
                },
                dataHealth: {
                    hasMemberFlow: true,
                    hasInviteSnapshots: true,
                    hasMessageActivity: true,
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
        memberFlow: {
            totalJoins: 0,
            totalLeaves: 0,
            netGrowth: 0,
            graph: [{ date: '2026-06-26', joins: 0, leaves: 0, netGrowth: 0 }],
        },
        invites: {
            activeInviteCount: 0,
            totalInviteUses: 0,
            attribution: {
                attributed: 0,
                'baseline-missing': 0,
                ambiguous: 0,
                unavailable: 0,
                'not-applicable': 0,
            },
            topInviters: [],
        },
        messages: {
            totalMessages: 0,
            graph: [{ date: '2026-06-26', messageCount: 0 }],
            topChannels: [],
        },
        dataHealth: {
            hasMemberFlow: false,
            hasInviteSnapshots: false,
            hasMessageActivity: false,
        },
    };
}

function createOverview() {
    return {
        memberFlow: {
            totalJoins: 0,
            totalLeaves: 0,
            netGrowth: 0,
            graph: [{ date: '2026-06-26', joins: 0, leaves: 0, netGrowth: 0 }],
        },
        invites: {
            activeInviteCount: 0,
            totalInviteUses: 0,
            attribution: {
                attributed: 0,
                baselineMissing: 0,
                ambiguous: 0,
                unavailable: 0,
                notApplicable: 0,
            },
            topInviters: [],
        },
        messages: {
            totalMessages: 0,
            graph: [{ date: '2026-06-26', messageCount: 0 }],
            topChannels: [],
        },
        dataHealth: {
            hasMemberFlow: false,
            hasInviteSnapshots: false,
            hasMessageActivity: false,
        },
    };
}
