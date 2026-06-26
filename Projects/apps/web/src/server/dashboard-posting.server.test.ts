import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import { listBotActionEventPageByGuildId, recordBotActionEvent, recordPostedMessage } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer/guild-structure';
import type * as FluxerGuildStructure from '@neonflux/fluxer/guild-structure';
import { sendFluxerBotGuildChannelMessage } from '@neonflux/fluxer/messages';
import type * as FluxerMessages from '@neonflux/fluxer/messages';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    loadDashboardGuildAuditEventsPage,
    loadDashboardGuildPostingChannels,
    postDashboardGuildMessage,
} from './dashboard-posting.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1');
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
        listBotActionEventPageByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        recordPostedMessage: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/messages', async (importActual) => {
    const actual = await importActual<typeof FluxerMessages>();

    return {
        ...actual,
        sendFluxerBotGuildChannelMessage: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/guild-structure', async (importActual) => {
    const actual = await importActual<typeof FluxerGuildStructure>();

    return {
        ...actual,
        readFluxerBotGuildStructure: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard posting', () => {
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
        vi.mocked(sendFluxerBotGuildChannelMessage).mockResolvedValue(
            ok({
                id: 'message-1',
                guildId: 'guild-1',
                channelId: 'channel-1',
            })
        );
        vi.mocked(recordPostedMessage).mockResolvedValue(ok(createPostedMessageRecord()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createBotActionEventRecord()));
        vi.mocked(listBotActionEventPageByGuildId).mockResolvedValue(
            ok({
                records: [createBotActionEventRecord()],
            })
        );
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
                    {
                        id: 'channel-2',
                        name: 'updates',
                        type: 0,
                        parentId: 'category-1',
                        position: 2,
                        permissionOverwrites: [],
                    },
                    {
                        id: 'voice-1',
                        name: 'Voice',
                        type: 2,
                        parentId: null,
                        position: 3,
                        permissionOverwrites: [],
                    },
                    {
                        id: 'channel-1',
                        name: 'general',
                        type: 0,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
                categories: [
                    {
                        id: 'category-1',
                        name: 'Info',
                        type: 4,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            })
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('denies unauthenticated users before sending', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
    });

    it('denies unavailable or unauthorized guilds before sending', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'not-found' });

        await expect(
            postDashboardGuildMessage(request, {
                guildId: 'guild-1',
                channelId: 'channel-1',
                content: 'hello',
            })
        ).resolves.toStrictEqual({ type: 'not-found' });

        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(
            postDashboardGuildMessage(request, {
                guildId: 'guild-1',
                channelId: 'channel-1',
                content: 'hello',
            })
        ).resolves.toStrictEqual({ type: 'not-found' });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
    });

    it('rejects blank payloads before sending', async () => {
        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: '   ',
            embeds: [],
        });

        expect(result).toStrictEqual({
            type: 'invalid-message',
            message: 'Add message content or at least one embed.',
        });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
    });

    it('requires the web deployment to have the bot token configured', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result).toStrictEqual({ type: 'bot-token-missing' });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
    });

    it('maps Fluxer send failures without recording trace rows', async () => {
        vi.mocked(sendFluxerBotGuildChannelMessage).mockResolvedValueOnce(err({ type: 'send-failed', error: 'nope' }));

        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result).toStrictEqual({ type: 'send-failed' });
        expect(recordPostedMessage).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('sends authorized dashboard messages and records posting traceability', async () => {
        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: ' channel-1 ',
            content: ' hello ',
            embeds: [{ title: 'NeonFlux' }],
        });

        expect(result).toStrictEqual({
            type: 'sent',
            message: {
                id: 'message-1',
                guildId: 'guild-1',
                channelId: 'channel-1',
            },
        });
        expect(sendFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
            embeds: [{ title: 'NeonFlux' }],
        });
        expect(recordPostedMessage).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
                createdByUserId: 'actor-1',
                purpose: 'dashboard',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                feature: 'posting',
                action: 'message.sent',
                actorUserId: 'actor-1',
                targetId: 'message-1',
                metadata: {
                    channelId: 'channel-1',
                    channelName: 'general',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                    messageId: 'message-1',
                    contentLength: 5,
                    embedCount: 1,
                    source: 'dashboard',
                },
            }
        );
    });

    it('returns sent-with-record-error when the message sends but trace recording fails', async () => {
        vi.mocked(recordBotActionEvent).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result).toStrictEqual({
            type: 'sent-with-record-error',
            message: {
                id: 'message-1',
                guildId: 'guild-1',
                channelId: 'channel-1',
            },
        });
    });

    it('loads audit events only through the authorized guild scope', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });

        const result = await loadDashboardGuildAuditEventsPage(request, { guildId: 'requested-guild' });

        expect(result).toStrictEqual({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                    targetId: 'message-1',
                    metadata: {
                        channelId: 'channel-1',
                        messageId: 'message-1',
                        contentLength: 5,
                        embedCount: 0,
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        expect(listBotActionEventPageByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                limit: 40,
            }
        );
    });

    it('loads the next audit event page with cursor, scoped search, timezone offset, and a bounded limit', async () => {
        vi.mocked(listBotActionEventPageByGuildId).mockResolvedValueOnce(
            ok({
                records: [createBotActionEventRecord()],
                nextCursor: {
                    createdAt: new Date('2026-06-25T00:00:00.000Z'),
                    id: 'event-cursor',
                },
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
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                    targetId: 'message-1',
                    metadata: {
                        channelId: 'channel-1',
                        messageId: 'message-1',
                        contentLength: 5,
                        embedCount: 0,
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T00:00:00.000Z',
                },
            ],
            nextCursor: '2026-06-25T00:00:00.000Z|event-cursor',
        });
        expect(listBotActionEventPageByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                cursor: {
                    createdAt: new Date('2026-06-26T00:00:00.000Z'),
                    id: 'event-1',
                },
                limit: 25,
                search: 'channel-1',
                searchScope: 'channel',
                searchOffsetMinutes: -120,
            }
        );
    });

    it('loads sendable posting channels only through the authorized guild scope', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });

        const result = await loadDashboardGuildPostingChannels(request, 'requested-guild');

        expect(result).toStrictEqual({
            type: 'channels',
            channels: [
                {
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    position: 1,
                },
                {
                    id: 'channel-2',
                    name: 'updates',
                    type: 0,
                    parentId: 'category-1',
                    parentName: 'Info',
                    position: 2,
                },
            ],
        });
        expect(readFluxerBotGuildStructure).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
        });
    });

    it('requires the bot token before loading posting channels', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await loadDashboardGuildPostingChannels(request, 'guild-1');

        expect(result).toStrictEqual({ type: 'bot-token-missing' });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('maps channel lookup failures without leaking Fluxer errors', async () => {
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValueOnce(err({ type: 'login-failed', error: 'bad-token' }));

        const result = await loadDashboardGuildPostingChannels(request, 'guild-1');

        expect(result).toStrictEqual({ type: 'guild-lookup-failed' });
    });
});

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

function createPostedMessageRecord() {
    return {
        id: 'posted-message-1',
        guildId: 'guild-1',
        templateId: null,
        channelId: 'channel-1',
        messageId: 'message-1',
        createdByUserId: 'actor-1',
        purpose: 'dashboard',
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        updatedAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}

function createBotActionEventRecord() {
    return {
        id: 'event-1',
        guildId: 'guild-1',
        feature: 'posting',
        action: 'message.sent',
        actorUserId: 'actor-1',
        targetId: 'message-1',
        metadata: {
            channelId: 'channel-1',
            messageId: 'message-1',
            contentLength: 5,
            embedCount: 0,
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}
