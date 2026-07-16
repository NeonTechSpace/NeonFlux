import {
    enqueueDashboardPostingOperation,
    listBotActionEventPageByGuildId,
    listDashboardPostingOperationsByGuild,
    resolveDashboardPostingOperationUnknown,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readDashboardBotGuildStructure, wakeDashboardBotPostingWorker } from './bot-internal-api-client.server.js';
import { authorizeDashboardPostingTarget } from './dashboard-posting-authorization.server.js';
import {
    loadDashboardGuildAuditEventsPage,
    loadDashboardGuildPostingCatalog,
    loadDashboardGuildPostingOperations,
    postDashboardGuildMessage,
    resolveDashboardGuildPostingUnknown,
} from './dashboard-posting.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const webLogger = vi.hoisted(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
}));

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

vi.mock('./dashboard-posting-authorization.server.js', () => ({
    authorizeDashboardPostingTarget: vi.fn(),
}));

vi.mock('./fluxer-auth-context.server.js', () => ({
    readAuthenticatedFluxerContext: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        enqueueDashboardPostingOperation: vi.fn(),
        listBotActionEventPageByGuildId: vi.fn(),
        listDashboardPostingOperationsByGuild: vi.fn(),
        resolveDashboardPostingOperationUnknown: vi.fn(),
    };
});

vi.mock('./bot-internal-api-client.server.js', () => ({
    readDashboardBotGuildStructure: vi.fn(),
    wakeDashboardBotPostingWorker: vi.fn(),
}));

vi.mock('./web-logger.server.js', () => ({
    getWebLogger: () => webLogger,
}));

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard posting', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'guild-1',
                name: 'Guild One',
            },
        });
        vi.mocked(authorizeDashboardPostingTarget).mockResolvedValue(
            ok({
                mode: { instanceMode: 'multi' },
                guild: {
                    canManage: true,
                    id: 'guild-1',
                    name: 'Guild One',
                },
            })
        );
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(ok(authContext));
        vi.mocked(wakeDashboardBotPostingWorker).mockResolvedValue(ok(undefined));
        vi.mocked(enqueueDashboardPostingOperation).mockResolvedValue(
            ok({ created: true, operation: createPostingOperationRecord() })
        );
        vi.mocked(listDashboardPostingOperationsByGuild).mockResolvedValue(ok([createPostingOperationRecord()]));
        vi.mocked(resolveDashboardPostingOperationUnknown).mockResolvedValue(
            ok({
                ...createPostingOperationRecord(),
                resolution: 'reported_seen',
                resolvedAt: new Date('2026-06-26T00:01:00.000Z'),
                resolvedByUserId: 'actor-1',
                status: 'unknown',
            })
        );
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
        vi.mocked(readDashboardBotGuildStructure).mockResolvedValue(
            ok({
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [
                    {
                        id: 'role-1',
                        name: 'Operators',
                        position: 4,
                        color: 0x5ad7ff,
                        permissions: '8',
                        hoist: true,
                        mentionable: false,
                        protected: true,
                        protectionReason: 'managed',
                    },
                ],
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
                        id: 'announcement-1',
                        name: 'Announcements',
                        type: 5,
                        parentId: null,
                        position: 4,
                        permissionOverwrites: [],
                    },
                    {
                        id: 'link-1',
                        name: 'External',
                        type: 998,
                        parentId: null,
                        position: 5,
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

    it('reauthorizes and records an unknown-delivery observation as the signed-in actor', async () => {
        const result = await resolveDashboardGuildPostingUnknown(request, {
            guildId: 'requested-guild',
            operationId: 'operation-1',
            resolution: 'reported_seen',
        });

        expect(result).toMatchObject({
            operation: { resolution: 'reported_seen', resolvedByUserId: 'actor-1', status: 'unknown' },
            type: 'resolved',
        });
        expect(resolveDashboardPostingOperationUnknown).toHaveBeenCalledWith(
            {},
            {
                actorDisplayName: 'Neonsy',
                actorUserId: 'actor-1',
                actorUsername: 'neonsy',
                guildId: 'guild-1',
                operationId: 'operation-1',
                resolution: 'reported_seen',
            }
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('denies unauthenticated users before queueing', async () => {
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValueOnce(err('missing-cookie'));

        const result = await postDashboardGuildMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
            requestKey: 'request-1',
        });

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(authorizeDashboardPostingTarget).not.toHaveBeenCalled();
        expect(enqueueDashboardPostingOperation).not.toHaveBeenCalled();
        expect(webLogger.info).toHaveBeenCalledWith(
            'posting.request_timing',
            expect.objectContaining({ result: 'auth_required' })
        );
    });

    it('denies unavailable or unauthorized guilds before queueing', async () => {
        vi.mocked(authorizeDashboardPostingTarget).mockResolvedValueOnce(err('not-found'));

        await expect(
            postDashboardGuildMessage(request, {
                guildId: 'guild-1',
                channelId: 'channel-1',
                content: 'hello',
                requestKey: 'request-1',
            })
        ).resolves.toStrictEqual({ type: 'not-found' });

        vi.mocked(authorizeDashboardPostingTarget).mockResolvedValueOnce(err('not-found'));

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
                actorUserId: 'actor-1',
                content: 'hello',
                embeds: [{ title: 'NeonFlux' }],
                guildId: 'guild-1',
                payloadHash: expect.stringMatching(/^[a-f\d]{64}$/),
                requestKey: 'request-1',
                requestedChannelId: 'channel-1',
            })
        );
        expect(readAuthenticatedFluxerContext).toHaveBeenCalledTimes(1);
        expect(getFluxerCurrentUser).not.toHaveBeenCalled();
        expect(wakeDashboardBotPostingWorker).toHaveBeenCalledTimes(1);
        expect(webLogger.info).toHaveBeenCalledWith(
            'posting.request_timing',
            expect.objectContaining({
                authContextMs: expect.any(Number),
                enqueueMs: expect.any(Number),
                operationId: 'operation-1',
                requestStartedAtMs: expect.any(Number),
                requestTotalMs: expect.any(Number),
                result: 'operation',
                targetAuthorizationMs: expect.any(Number),
                validationMs: expect.any(Number),
                wakeMs: expect.any(Number),
            })
        );
        expect(webLogger.info).not.toHaveBeenCalledWith(
            'posting.request_timing',
            expect.objectContaining({ actorUserId: expect.anything() })
        );
        expect(webLogger.info).not.toHaveBeenCalledWith(
            'posting.request_timing',
            expect.objectContaining({ guildId: expect.anything() })
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
        expect(wakeDashboardBotPostingWorker).not.toHaveBeenCalled();
    });

    it('keeps the queued operation successful when the best-effort bot wake fails', async () => {
        vi.mocked(wakeDashboardBotPostingWorker).mockResolvedValueOnce(err('transport-failed'));

        const result = await postDashboardGuildMessage(request, {
            channelId: 'channel-1',
            content: 'hello',
            guildId: 'guild-1',
            requestKey: 'request-1',
        });

        expect(result).toStrictEqual({ type: 'operation', operation: createPostingOperationView() });
        expect(wakeDashboardBotPostingWorker).toHaveBeenCalledTimes(1);
        expect(webLogger.warn).toHaveBeenCalledWith('posting.wake_failed', {
            errorClass: 'transport-failed',
            requestDurationMs: expect.any(Number),
            suppressedCount: 0,
        });
    });

    it('keeps the queued operation successful if the wake client unexpectedly rejects', async () => {
        vi.mocked(wakeDashboardBotPostingWorker).mockRejectedValueOnce(new Error('unexpected wake failure'));

        const result = await postDashboardGuildMessage(request, {
            channelId: 'channel-1',
            content: 'hello',
            guildId: 'guild-1',
            requestKey: 'request-1',
        });

        expect(result).toStrictEqual({ type: 'operation', operation: createPostingOperationView() });
        expect(webLogger.warn).toHaveBeenCalledWith('posting.wake_failed', {
            errorClass: 'unexpected-failure',
            requestDurationMs: expect.any(Number),
            suppressedCount: 0,
        });
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
        expect(webLogger.info).toHaveBeenCalledWith(
            'posting.request_timing',
            expect.objectContaining({ result: 'request_conflict' })
        );
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

        const result = await loadDashboardGuildPostingCatalog(request, 'requested-guild');

        expect(result).toStrictEqual({
            type: 'catalog',
            catalog: {
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
                roles: [{ id: 'role-1', name: 'Operators', color: 0x5ad7ff }],
            },
        });
        expect(readDashboardBotGuildStructure).toHaveBeenCalledTimes(1);
        expect(readDashboardBotGuildStructure).toHaveBeenCalledWith('authorized-guild');
    });

    it('reports an unavailable bot internal API before loading posting channels', async () => {
        vi.mocked(readDashboardBotGuildStructure).mockResolvedValueOnce(err('not-configured'));

        const result = await loadDashboardGuildPostingCatalog(request, 'guild-1');

        expect(result).toStrictEqual({ type: 'bot-token-missing' });
    });

    it('maps channel lookup failures without leaking Fluxer errors', async () => {
        vi.mocked(readDashboardBotGuildStructure).mockResolvedValueOnce(err('read-failed'));

        const result = await loadDashboardGuildPostingCatalog(request, 'guild-1');

        expect(result).toStrictEqual({ type: 'guild-lookup-failed' });
    });
});

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
        followupOperationId: null,
        guildId: 'guild-1',
        id: 'operation-1',
        messageId: null,
        nextAttemptAt: null,
        requestKey: 'request-1',
        requestedChannelId: 'channel-1',
        resolution: null,
        resolvedAt: null,
        resolvedByUserId: null,
        retryOfOperationId: null,
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
