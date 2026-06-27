import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    createGiveaway,
    drawGiveawayWinners,
    listActiveGiveawayEntries,
    listGiveawayWinners,
    listGiveawaysByGuildId,
    recordBotActionEvent,
    recordGiveawayEvent,
    updateGiveawayStatus,
} from '@neonflux/db';
import type { GiveawayEntryRecord, GiveawayRecord, GiveawayWinnerRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import {
    reactFluxerBotGuildChannelMessage,
    readFluxerBotGuildStructure,
    sendFluxerBotGuildChannelMessage,
} from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    cancelDashboardGiveaway,
    closeDashboardGiveaway,
    loadDashboardGiveawaysSettings,
    publishDashboardGiveaway,
    rerollDashboardGiveaway,
} from './dashboard-giveaways.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/community');
const authContext = {
    session: {
        id: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
        fluxerUserId: 'actor-1',
        createdAt: new Date('2026-06-21T00:00:00.000Z'),
        expiresAt: new Date('2026-06-28T00:00:00.000Z'),
        revokedAt: null,
    },
    fluxerUserId: 'actor-1',
    accessToken: 'fresh-access-token',
    scopes: ['identify', 'guilds'],
    accessTokenExpiresAt: new Date('2026-06-21T01:00:00.000Z'),
};

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-guild-page.server.js', () => ({
    loadDashboardGuildPageData: vi.fn(),
}));

vi.mock('./fluxer-auth-context.server.js', () => ({
    readAuthenticatedFluxerContext: vi.fn(),
}));

vi.mock('@neonflux/config', () => ({
    loadWebConfig: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        createGiveaway: vi.fn(),
        drawGiveawayWinners: vi.fn(),
        listActiveGiveawayEntries: vi.fn(),
        listGiveawayWinners: vi.fn(),
        listGiveawaysByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        recordGiveawayEvent: vi.fn(),
        updateGiveawayStatus: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

    return {
        ...actual,
        reactFluxerBotGuildChannelMessage: vi.fn(),
        readFluxerBotGuildStructure: vi.fn(),
        sendFluxerBotGuildChannelMessage: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard giveaways', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue(createWebConfig());
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'guild-1',
                name: 'Guild One',
            },
        });
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(ok(authContext));
        vi.mocked(getFluxerCurrentUser).mockResolvedValue(
            ok({
                id: 'actor-1',
                username: 'neonsy',
                discriminator: '0',
                globalName: 'Neonsy',
                avatar: null,
            })
        );
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(
            ok({
                guildId: 'guild-1',
                roles: [],
                channels: [
                    createFluxerChannel({
                        id: 'giveaway-channel-1',
                        name: 'giveaways',
                        type: 0,
                        parentId: 'category-1',
                        position: 2,
                    }),
                    createFluxerChannel({
                        id: 'voice-1',
                        name: 'Voice',
                        type: 2,
                        position: 3,
                    }),
                ],
                categories: [
                    createFluxerChannel({
                        id: 'category-1',
                        name: 'Community',
                        type: 4,
                        position: 1,
                    }),
                ],
            })
        );
        vi.mocked(listGiveawaysByGuildId).mockResolvedValue(ok([createGiveawayRecord()]));
        vi.mocked(listActiveGiveawayEntries).mockResolvedValue(ok([createEntry()]));
        vi.mocked(listGiveawayWinners).mockResolvedValue(ok([]));
        vi.mocked(createGiveaway).mockResolvedValue(ok(createGiveawayRecord({ messageId: 'message-2' })));
        vi.mocked(updateGiveawayStatus).mockResolvedValue(ok(createGiveawayRecord({ status: 'cancelled' })));
        vi.mocked(drawGiveawayWinners).mockResolvedValue(
            ok({
                giveaway: createGiveawayRecord({ status: 'closed', closedAt: new Date('2026-06-26T10:05:00.000Z') }),
                winners: [createWinner()],
            })
        );
        vi.mocked(sendFluxerBotGuildChannelMessage).mockResolvedValue(
            ok({
                id: 'message-2',
                guildId: 'guild-1',
                channelId: 'giveaway-channel-1',
            })
        );
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValue(ok(undefined));
        vi.mocked(recordGiveawayEvent).mockResolvedValue(ok(createGiveawayEventRecord()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads configured giveaways with channel labels', async () => {
        const result = await loadDashboardGiveawaysSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            structureReadStatus: 'available',
            channels: [
                {
                    id: 'giveaway-channel-1',
                    name: 'giveaways',
                    type: 0,
                    parentId: 'category-1',
                    parentName: 'Community',
                    position: 2,
                },
            ],
            giveaways: [
                expect.objectContaining({
                    id: 'giveaway-1',
                    channelName: 'giveaways',
                    entryCount: 1,
                    syncStatus: 'active',
                    winners: [],
                }),
            ],
        });
        expect(listGiveawaysByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1', limit: 50 });
    });

    it('loads saved giveaways when the web service has no bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await loadDashboardGiveawaysSettings(request, 'guild-1');

        expect(result).toMatchObject({
            type: 'settings',
            structureReadStatus: 'bot-token-missing',
            channels: [],
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('denies unavailable or unauthorized guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await publishDashboardGiveaway(request, createPublishInput());

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
        expect(createGiveaway).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('publishes giveaways through the authorized guild scope and records audit', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });
        vi.mocked(createGiveaway).mockResolvedValueOnce(
            ok(createGiveawayRecord({ guildId: 'authorized-guild', messageId: 'message-2' }))
        );

        const result = await publishDashboardGiveaway(request, createPublishInput({ guildId: 'requested-guild' }));

        expect(result).toMatchObject({
            type: 'updated',
            giveaway: {
                messageId: 'message-2',
                title: 'Launch giveaway',
            },
            announcementStatus: 'sent',
        });
        expect(sendFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
            channelId: 'giveaway-channel-1',
            embeds: [expect.objectContaining({ title: 'Launch giveaway' })],
        });
        expect(reactFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
            channelId: 'giveaway-channel-1',
            messageId: 'message-2',
            emoji: '🎉',
        });
        expect(createGiveaway).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                channelId: 'giveaway-channel-1',
                messageId: 'message-2',
                title: 'Launch giveaway',
                prize: 'Nitro',
                status: 'active',
                createdByUserId: 'actor-1',
                config: {
                    syncStatus: 'active',
                },
            })
        );
        expect(recordGiveawayEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                giveawayId: 'giveaway-1',
                eventType: 'published',
                actorUserId: 'actor-1',
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'giveaways',
                action: 'giveaway.published',
                actorUserId: 'actor-1',
                targetId: 'giveaway-1',
                metadata: {
                    giveawayId: 'giveaway-1',
                    channelId: 'giveaway-channel-1',
                    messageId: 'message-2',
                    source: 'dashboard',
                    syncStatus: 'active',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('records published giveaways as stale when reaction setup fails', async () => {
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValueOnce(
            err({ type: 'react-failed', error: new Error('missing access') })
        );
        vi.mocked(createGiveaway).mockResolvedValueOnce(
            ok(createGiveawayRecord({ config: { syncStatus: 'stale' }, messageId: 'message-2' }))
        );

        const result = await publishDashboardGiveaway(request, createPublishInput());

        expect(result).toMatchObject({
            type: 'updated',
            announcementStatus: 'failed',
        });
        expect(createGiveaway).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                config: {
                    syncStatus: 'stale',
                },
            })
        );
    });

    it('blocks invalid and unconfigured publish requests before sending', async () => {
        await expect(publishDashboardGiveaway(request, createPublishInput({ prize: '' }))).resolves.toStrictEqual({
            type: 'invalid-input',
            field: 'prize',
        });

        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));
        await expect(publishDashboardGiveaway(request, createPublishInput())).resolves.toStrictEqual({
            type: 'bot-token-missing',
        });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
    });

    it('surfaces giveaway event recording failures', async () => {
        vi.mocked(recordGiveawayEvent).mockResolvedValueOnce(err({ type: 'database-error' }));

        await expect(publishDashboardGiveaway(request, createPublishInput())).resolves.toStrictEqual({
            type: 'database-error',
        });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('closes and rerolls giveaways with announcements and audit events', async () => {
        const closeResult = await closeDashboardGiveaway(request, { guildId: 'guild-1', giveawayId: 'giveaway-1' });
        const rerollResult = await rerollDashboardGiveaway(request, { guildId: 'guild-1', giveawayId: 'giveaway-1' });

        expect(closeResult).toMatchObject({ type: 'updated', announcementStatus: 'sent' });
        expect(rerollResult).toMatchObject({ type: 'updated', announcementStatus: 'sent' });
        expect(drawGiveawayWinners).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                giveawayId: 'giveaway-1',
                actorUserId: 'actor-1',
                reroll: false,
            }
        );
        expect(drawGiveawayWinners).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                giveawayId: 'giveaway-1',
                actorUserId: 'actor-1',
                reroll: true,
            }
        );
        expect(sendFluxerBotGuildChannelMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('<@winner-1>'),
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'giveaways',
                action: 'giveaway.closed',
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'giveaways',
                action: 'giveaway.rerolled',
            })
        );
    });

    it('cancels giveaways with an announcement and audit event', async () => {
        const result = await cancelDashboardGiveaway(request, { guildId: 'guild-1', giveawayId: 'giveaway-1' });

        expect(result).toMatchObject({ type: 'updated', announcementStatus: 'sent' });
        expect(updateGiveawayStatus).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                giveawayId: 'giveaway-1',
                status: 'cancelled',
                actorUserId: 'actor-1',
            }
        );
        expect(sendFluxerBotGuildChannelMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'Giveaway cancelled: Launch giveaway',
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'giveaways',
                action: 'giveaway.cancelled',
            })
        );
    });
});

function createPublishInput(overrides: Partial<Parameters<typeof publishDashboardGiveaway>[1]> = {}) {
    return {
        guildId: 'guild-1',
        channelId: 'giveaway-channel-1',
        title: 'Launch giveaway',
        prize: 'Nitro',
        description: 'React to enter.',
        entryEmoji: '🎉',
        winnerCount: 1,
        endsAt: '2026-06-27T10:30:00.000Z',
        ...overrides,
    };
}

function createWebConfig(overrides: Partial<WebConfig> = {}): WebConfig {
    return {
        appEnv: 'production',
        databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
        autoMigrate: true,
        guildDefconOverride: 'auto',
        logLevel: 'info',
        nodeEnv: 'test',
        fluxerBotToken: 'bot-token',
        ...overrides,
    };
}

function createGiveawayRecord(overrides: Partial<GiveawayRecord> = {}): GiveawayRecord {
    const timestamp = new Date('2026-06-26T10:00:00.000Z');

    return {
        id: 'giveaway-1',
        guildId: 'guild-1',
        channelId: 'giveaway-channel-1',
        messageId: 'giveaway-message-1',
        title: 'Launch giveaway',
        prize: 'Nitro',
        description: 'React to enter.',
        entryEmoji: '🎉',
        winnerCount: 1,
        status: 'active',
        endsAt: new Date('2026-06-27T10:30:00.000Z'),
        createdByUserId: 'actor-1',
        closedByUserId: null,
        closedAt: null,
        config: {
            syncStatus: 'active',
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createEntry(overrides: Partial<GiveawayEntryRecord> = {}): GiveawayEntryRecord {
    return {
        id: 'entry-1',
        giveawayId: 'giveaway-1',
        userId: 'user-1',
        enteredAt: new Date('2026-06-26T10:01:00.000Z'),
        removedAt: null,
        ...overrides,
    };
}

function createWinner(overrides: Partial<GiveawayWinnerRecord> = {}): GiveawayWinnerRecord {
    return {
        id: 'winner-row-1',
        giveawayId: 'giveaway-1',
        userId: 'winner-1',
        drawNumber: 1,
        selectedAt: new Date('2026-06-26T10:05:00.000Z'),
        ...overrides,
    };
}

function createFluxerChannel(overrides: {
    id: string;
    name: string;
    type: number;
    parentId?: string;
    position: number;
}) {
    return {
        permissionOverwrites: [],
        parentId: null,
        ...overrides,
    };
}

function createGiveawayEventRecord() {
    return {
        id: 'giveaway-event-1',
        giveawayId: 'giveaway-1',
        eventType: 'published',
        actorUserId: 'actor-1',
        details: {},
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'giveaways',
        action: 'giveaway.published',
        actorUserId: 'actor-1',
        targetId: 'giveaway-1',
        metadata: {
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
    };
}
