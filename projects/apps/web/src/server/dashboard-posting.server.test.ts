import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    enqueueDashboardPostingOperation,
    listBotActionEventPageByGuildId,
    listDashboardPostingOperationsByGuild,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer/guild-structure';
import type * as FluxerGuildStructure from '@neonflux/fluxer/guild-structure';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    loadDashboardGuildAuditEventsPage,
    loadDashboardGuildPostingChannels,
    loadDashboardGuildPostingOperations,
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

vi.mock('./db.server.js', () => ({
    getWebDb: () => ({
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
        enqueueDashboardPostingOperation: vi.fn(),
        listBotActionEventPageByGuildId: vi.fn(),
        listDashboardPostingOperationsByGuild: vi.fn(),
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
        vi.mocked(enqueueDashboardPostingOperation).mockResolvedValue(
            ok({ created: true, operation: createPostingOperationRecord() })
        );
        vi.mocked(listDashboardPostingOperationsByGuild).mockResolvedValue(ok([createPostingOperationRecord()]));
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
                guildName: 'Guild 1',
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

    it('denies unauthenticated users before queueing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
            requestKey: 'request-1',
        });

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(enqueueDashboardPostingOperation).not.toHaveBeenCalled();
    });

    it('denies unavailable or unauthorized guilds before queueing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'not-found' });

        await expect(
            postDashboardGuildMessage(request, {
                guildId: 'guild-1',
                channelId: 'channel-1',
                content: 'hello',
                requestKey: 'request-1',
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
                requestKey: 'request-1',
            })
        ).resolves.toStrictEqual({ type: 'not-found' });
        expect(enqueueDashboardPostingOperation).not.toHaveBeenCalled();
    });

    it('rejects blank payloads before queueing', async () => {
        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: '   ',
            embeds: [],
            requestKey: 'request-1',
        });

        expect(result).toStrictEqual({
            type: 'invalid-message',
            message: 'Add message content or at least one embed.',
        });
        expect(enqueueDashboardPostingOperation).not.toHaveBeenCalled();
    });

    it('queues authorized dashboard messages with actor and idempotency data', async () => {
        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: ' channel-1 ',
            content: ' hello ',
            embeds: [{ title: 'NeonFlux' }],
            requestKey: 'request-1',
        });

        expect(result).toStrictEqual({
            type: 'operation',
            operation: createPostingOperationView(),
        });
        expect(enqueueDashboardPostingOperation).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actorDisplayName: 'Neonsy',
                actorUserId: 'actor-1',
                actorUsername: 'neonsy',
                content: 'hello',
                embeds: [{ title: 'NeonFlux' }],
                guildId: 'guild-1',
                payloadHash: expect.stringMatching(/^[a-f\d]{64}$/),
                requestKey: 'request-1',
                requestedChannelId: 'channel-1',
            })
        );
    });

    it('returns the existing operation for an idempotent replay', async () => {
        vi.mocked(enqueueDashboardPostingOperation).mockResolvedValueOnce(
            ok({ created: false, operation: createPostingOperationRecord({ status: 'sent' }) })
        );

        const result = await postDashboardGuildMessage(request, {
            channelId: 'channel-1',
            content: 'hello',
            guildId: 'guild-1',
            requestKey: 'request-1',
        });

        expect(result).toStrictEqual({
            operation: createPostingOperationView({ status: 'sent' }),
            type: 'operation',
        });
        expect(enqueueDashboardPostingOperation).toHaveBeenCalledTimes(1);
    });

    it('maps an idempotency conflict without exposing database details', async () => {
        vi.mocked(enqueueDashboardPostingOperation).mockResolvedValueOnce(
            err({ field: 'requestKey', type: 'conflict' })
        );

        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
            requestKey: 'request-1',
        });

        expect(result).toStrictEqual({ type: 'request-conflict' });
    });

    it('loads durable posting status only through the authorized guild scope', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: { id: 'authorized-guild', name: 'Authorized Guild' },
        });

        await expect(loadDashboardGuildPostingOperations(request, 'requested-guild')).resolves.toStrictEqual({
            operations: [createPostingOperationView()],
            type: 'operations',
        });
        expect(listDashboardPostingOperationsByGuild).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                limit: 20,
            }
        );
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
            nextCursor: 'opaque-next-cursor',
        });
        expect(listBotActionEventPageByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                cursor: '2026-06-26T00:00:00.000Z|event-1',
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
        guildDefconOverride: 'auto',
        logLevel: 'info',
        nodeEnv: 'test',
        fluxerBotToken: 'bot-token',
        ...overrides,
    };
}

function createPostingOperationRecord(overrides: { status?: 'queued' | 'sent' } = {}) {
    return {
        actorDisplayName: 'Neonsy',
        actorUsername: 'neonsy',
        actorUserId: 'actor-1',
        attemptCount: 0,
        completedAt: null,
        contentLength: 5,
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        embedCount: 1,
        errorCode: null,
        guildId: 'guild-1',
        id: 'operation-1',
        messageId: null,
        nextAttemptAt: null,
        requestKey: 'request-1',
        requestedChannelId: 'channel-1',
        sentChannelId: null,
        status: overrides.status ?? 'queued',
        updatedAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}

function createPostingOperationView(overrides: { status?: 'queued' | 'sent' } = {}) {
    return {
        attemptCount: 0,
        contentLength: 5,
        createdAt: '2026-06-26T00:00:00.000Z',
        embedCount: 1,
        id: 'operation-1',
        requestKey: 'request-1',
        requestedChannelId: 'channel-1',
        status: overrides.status ?? 'queued',
        updatedAt: '2026-06-26T00:00:00.000Z',
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
