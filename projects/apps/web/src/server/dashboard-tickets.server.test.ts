import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    createTicketPanel,
    deleteTicketPanel,
    listTicketPanelsByGuildId,
    recordBotActionEvent,
    updateTicketPanel,
} from '@neonflux/db';
import type { TicketPanelRecord } from '@neonflux/db';
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
    deleteDashboardTicketPanel,
    loadDashboardTicketsSettings,
    updateDashboardTicketPanel,
} from './dashboard-tickets.server.js';
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
        createTicketPanel: vi.fn(),
        deleteTicketPanel: vi.fn(),
        listTicketPanelsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        updateTicketPanel: vi.fn(),
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

describe('dashboard ticket panel settings', () => {
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
                roles: [
                    {
                        id: 'support-role-1',
                        name: 'Support',
                        position: 5,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                channels: [
                    createFluxerChannel({
                        id: 'ticket-channel-1',
                        name: 'tickets',
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
        vi.mocked(listTicketPanelsByGuildId).mockResolvedValue(ok([createPanel()]));
        vi.mocked(createTicketPanel).mockResolvedValue(ok(createPanel({ messageId: 'ticket-message-2' })));
        vi.mocked(updateTicketPanel).mockResolvedValue(ok(createPanel({ messageId: 'ticket-message-2' })));
        vi.mocked(deleteTicketPanel).mockResolvedValue(ok(createPanel()));
        vi.mocked(sendFluxerBotGuildChannelMessage).mockResolvedValue(
            ok({
                id: 'ticket-message-2',
                guildId: 'guild-1',
                channelId: 'ticket-channel-1',
            })
        );
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValue(ok(undefined));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads configured panels with channel and role labels', async () => {
        const result = await loadDashboardTicketsSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            structureReadStatus: 'available',
            textChannels: [
                {
                    id: 'ticket-channel-1',
                    name: 'tickets',
                    type: 0,
                    parentId: 'category-1',
                    parentName: 'Community',
                    position: 2,
                },
            ],
            categories: [
                {
                    id: 'category-1',
                    name: 'Community',
                    position: 1,
                },
            ],
            roles: [
                {
                    id: 'support-role-1',
                    name: 'Support',
                    position: 5,
                    color: 0,
                },
            ],
            panels: [
                {
                    id: 'ticket-panel-1',
                    channelId: 'ticket-channel-1',
                    channelName: 'tickets',
                    messageId: 'ticket-message-1',
                    title: 'Support tickets',
                    enabled: true,
                    config: {
                        description: 'React to open a ticket.',
                        openEmoji: '🎫',
                        openEmojiKey: 'unicode:🎫',
                        ticketCategoryId: 'category-1',
                        staffRoleIds: ['support-role-1'],
                        ticketNameTemplate: 'ticket-{number}',
                        maxOpenPerUser: 1,
                        privateTickets: true,
                        syncStatus: 'active',
                    },
                    updatedAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        expect(listTicketPanelsByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('loads saved panels when the web service has no bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await loadDashboardTicketsSettings(request, 'guild-1');

        expect(result).toMatchObject({
            type: 'settings',
            structureReadStatus: 'bot-token-missing',
            textChannels: [],
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('denies unavailable or unauthorized guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await updateDashboardTicketPanel(request, createUpdateInput());

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
        expect(createTicketPanel).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('publishes panels through the authorized guild scope and records audit', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });
        vi.mocked(createTicketPanel).mockResolvedValueOnce(
            ok(createPanel({ guildId: 'authorized-guild', messageId: 'ticket-message-2' }))
        );

        const result = await updateDashboardTicketPanel(request, createUpdateInput({ guildId: 'requested-guild' }));

        expect(result).toMatchObject({
            type: 'updated',
            panel: {
                title: 'Support tickets',
                messageId: 'ticket-message-2',
            },
        });
        expect(sendFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
            channelId: 'ticket-channel-1',
            embeds: [expect.objectContaining({ title: 'Support tickets' })],
        });
        expect(reactFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
            channelId: 'ticket-channel-1',
            messageId: 'ticket-message-2',
            emoji: '🎫',
        });
        expect(createTicketPanel).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                channelId: 'ticket-channel-1',
                messageId: 'ticket-message-2',
                title: 'Support tickets',
                enabled: true,
                config: expect.objectContaining({
                    openEmoji: '🎫',
                    staffRoleIds: ['support-role-1'],
                    syncStatus: 'active',
                }),
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'tickets',
                action: 'panel.published',
                actorUserId: 'actor-1',
                targetId: 'ticket-panel-1',
                metadata: {
                    panelId: 'ticket-panel-1',
                    channelId: 'ticket-channel-1',
                    messageId: 'ticket-message-2',
                    enabled: true,
                    syncStatus: 'active',
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('records newly sent panels as stale when reaction setup fails', async () => {
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValueOnce(
            err({ type: 'react-failed', error: new Error('missing access') })
        );
        vi.mocked(createTicketPanel).mockResolvedValueOnce(
            ok(
                createPanel({
                    messageId: 'ticket-message-2',
                    config: {
                        ...defaultPanelConfig,
                        syncStatus: 'stale',
                    },
                })
            )
        );

        const result = await updateDashboardTicketPanel(request, createUpdateInput());

        expect(result).toMatchObject({
            type: 'updated',
            panel: {
                config: {
                    syncStatus: 'stale',
                },
            },
        });
        expect(createTicketPanel).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                config: expect.objectContaining({
                    syncStatus: 'stale',
                }),
            })
        );
    });

    it('deletes panels and records dashboard audit events', async () => {
        const result = await deleteDashboardTicketPanel(request, {
            guildId: 'guild-1',
            panelId: 'ticket-panel-1',
        });

        expect(result).toMatchObject({
            type: 'deleted',
            panel: {
                id: 'ticket-panel-1',
            },
        });
        expect(deleteTicketPanel).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                panelId: 'ticket-panel-1',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'tickets',
                action: 'panel.deleted',
                targetId: 'ticket-panel-1',
            })
        );
    });
});

function createUpdateInput(overrides: Partial<Parameters<typeof updateDashboardTicketPanel>[1]> = {}) {
    return {
        guildId: 'guild-1',
        channelId: 'ticket-channel-1',
        title: 'Support tickets',
        description: 'React to open a ticket.',
        openEmoji: '🎫',
        ticketCategoryId: 'category-1',
        staffRoleIds: ['support-role-1'],
        ticketNameTemplate: 'ticket-{number}',
        maxOpenPerUser: 1,
        privateTickets: true,
        enabled: true,
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

const defaultPanelConfig = {
    description: 'React to open a ticket.',
    openEmoji: '🎫',
    openEmojiKey: 'unicode:🎫',
    ticketCategoryId: 'category-1',
    staffRoleIds: ['support-role-1'],
    ticketNameTemplate: 'ticket-{number}',
    maxOpenPerUser: 1,
    privateTickets: true,
    syncStatus: 'active',
};

function createPanel(overrides: Partial<TicketPanelRecord> = {}): TicketPanelRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'ticket-panel-1',
        guildId: 'guild-1',
        channelId: 'ticket-channel-1',
        messageId: 'ticket-message-1',
        title: 'Support tickets',
        enabled: true,
        config: defaultPanelConfig,
        createdAt: timestamp,
        updatedAt: timestamp,
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

function createAuditEventRecord() {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'tickets',
        action: 'panel.published',
        actorUserId: 'actor-1',
        targetId: 'ticket-panel-1',
        metadata: {
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}
