import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    findReactionRoleMessage,
    listReactionRoleMessagesByGuildId,
    listReactionRoleOperationsByGuildId,
    requestReactionRoleDeleteOperation,
    requestReactionRolePublishOperation,
    requestReactionRoleSaveOperation,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildEmojis, readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    deleteDashboardReactionRoleMessage,
    loadDashboardReactionRolesSettings,
    publishDashboardReactionRoleMessage,
    saveDashboardReactionRoleMessage,
} from './dashboard-reaction-roles.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/access/reaction-roles');

vi.mock('./db.server.js', () => ({ getWebDb: () => ({ db: {} }) }));
vi.mock('./dashboard-guild-page.server.js', () => ({ loadDashboardGuildPageData: vi.fn() }));
vi.mock('./fluxer-auth-context.server.js', () => ({ readAuthenticatedFluxerContext: vi.fn() }));
vi.mock('@neonflux/config', () => ({ loadWebConfig: vi.fn() }));
vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    findReactionRoleMessage: vi.fn(),
    listReactionRoleMessagesByGuildId: vi.fn(),
    listReactionRoleOperationsByGuildId: vi.fn(),
    requestReactionRoleDeleteOperation: vi.fn(),
    requestReactionRolePublishOperation: vi.fn(),
    requestReactionRoleSaveOperation: vi.fn(),
}));
vi.mock('@neonflux/fluxer', async (importActual) => ({
    ...(await importActual<typeof Fluxer>()),
    readFluxerBotGuildEmojis: vi.fn(),
    readFluxerBotGuildStructure: vi.fn(),
}));
vi.mock('@neonflux/fluxer/users', async (importActual) => ({
    ...(await importActual<typeof FluxerUsers>()),
    getFluxerCurrentUser: vi.fn(),
}));

describe('dashboard reaction-role operations', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue(createWebConfig());
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: { id: 'guild-1', name: 'Guild One' },
        });
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(
            ok({
                accessToken: 'access',
                accessTokenExpiresAt: new Date('2026-07-10T09:00:00.000Z'),
                fluxerUserId: 'actor-1',
                scopes: ['identify', 'guilds'],
                session: {
                    createdAt: new Date('2026-07-10T07:00:00.000Z'),
                    expiresAt: new Date('2026-07-11T07:00:00.000Z'),
                    fluxerUserId: 'actor-1',
                    id: 'session-1',
                    revokedAt: null,
                },
            })
        );
        vi.mocked(getFluxerCurrentUser).mockResolvedValue(
            ok({ avatar: null, discriminator: '0', globalName: 'Actor', id: 'actor-1', username: 'actor' })
        );
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(
            ok({
                categories: [],
                channels: [
                    {
                        id: 'channel-1',
                        name: 'roles',
                        parentId: null,
                        permissionOverwrites: [],
                        position: 0,
                        type: 0,
                    },
                ],
                guildId: 'guild-1',
                guildName: 'Guild One',
                roles: [
                    {
                        color: 0,
                        hoist: false,
                        id: 'role-1',
                        mentionable: false,
                        name: 'Member',
                        permissions: '0',
                        position: 1,
                    },
                    {
                        color: 0,
                        hoist: false,
                        id: 'role-2',
                        mentionable: false,
                        name: 'News',
                        permissions: '0',
                        position: 2,
                    },
                ],
            })
        );
        vi.mocked(readFluxerBotGuildEmojis).mockResolvedValue(ok([]));
        vi.mocked(findReactionRoleMessage).mockResolvedValue(ok(createMessage()));
        vi.mocked(listReactionRoleMessagesByGuildId).mockResolvedValue(
            ok([{ ...createMessage(), options: [createOption()] }])
        );
        vi.mocked(listReactionRoleOperationsByGuildId).mockResolvedValue(ok([]));
        vi.mocked(requestReactionRolePublishOperation).mockResolvedValue(
            ok({ type: 'accepted', operation: createOperation('publish') })
        );
        vi.mocked(requestReactionRoleSaveOperation).mockResolvedValue(
            ok({ type: 'accepted', operation: createOperation('save') })
        );
        vi.mocked(requestReactionRoleDeleteOperation).mockResolvedValue(
            ok({ type: 'accepted', operation: createOperation('delete') })
        );
    });

    afterEach(() => vi.clearAllMocks());

    it('loads committed menus and durable operation summaries', async () => {
        vi.mocked(listReactionRoleOperationsByGuildId).mockResolvedValue(ok([createOperation('save')]));
        const result = await loadDashboardReactionRolesSettings(request, 'guild-1');
        expect(result).toMatchObject({
            type: 'settings',
            messages: [{ lifecycle: 'ready', revision: 1 }],
            operations: [{ id: 'operation-save', type: 'save', status: 'queued' }],
        });
    });

    it('queues publish without calling Fluxer from the web process', async () => {
        const result = await publishDashboardReactionRoleMessage(request, {
            channelId: 'channel-1',
            content: 'Choose {list}',
            embeds: [],
            generateOverview: true,
            guildId: 'guild-1',
            idempotencyKey: 'publish-1',
            mode: 'normal',
            options: [{ emojiKey: '✅', emojiLabel: '✅', position: 0, roleId: 'role-1' }],
        });
        expect(result).toMatchObject({ type: 'operation-accepted', operation: { type: 'publish' } });
        expect(requestReactionRolePublishOperation).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ idempotencyKey: 'publish-1', guildId: 'guild-1' })
        );
    });

    it('rejects duplicate roles before creating an operation', async () => {
        const result = await publishDashboardReactionRoleMessage(request, {
            channelId: 'channel-1',
            content: 'Choose',
            embeds: [],
            generateOverview: false,
            guildId: 'guild-1',
            idempotencyKey: 'publish-1',
            mode: 'normal',
            options: [
                { emojiKey: '✅', position: 0, roleId: 'role-1' },
                { emojiKey: '⭐', position: 1, roleId: 'role-1' },
            ],
        });
        expect(result).toStrictEqual({ type: 'invalid-input', field: 'roleId' });
        expect(requestReactionRolePublishOperation).not.toHaveBeenCalled();
    });

    it('rejects a crafted channel outside the live publishable channel set', async () => {
        const result = await publishDashboardReactionRoleMessage(request, {
            channelId: 'voice-channel',
            content: 'Choose',
            embeds: [],
            generateOverview: false,
            guildId: 'guild-1',
            idempotencyKey: 'publish-1',
            mode: 'normal',
            options: [{ emojiKey: '✅', position: 0, roleId: 'role-1' }],
        });

        expect(result).toStrictEqual({ type: 'invalid-input', field: 'channelId' });
        expect(requestReactionRolePublishOperation).not.toHaveBeenCalled();
    });

    it('queues revision-checked save and delete operations', async () => {
        const saved = await saveDashboardReactionRoleMessage(request, {
            content: 'Choose',
            embeds: [],
            expectedRevision: 1,
            generateOverview: false,
            guildId: 'guild-1',
            idempotencyKey: 'save-1',
            messageId: 'message-1',
            mode: 'normal',
            options: [{ emojiKey: '✅', position: 0, roleId: 'role-1' }],
        });
        const deleted = await deleteDashboardReactionRoleMessage(request, {
            expectedRevision: 1,
            guildId: 'guild-1',
            idempotencyKey: 'delete-1',
            messageId: 'message-1',
        });
        expect(saved).toMatchObject({ type: 'operation-accepted', operation: { type: 'save' } });
        expect(deleted).toMatchObject({ type: 'operation-accepted', operation: { type: 'delete' } });
        expect(requestReactionRoleSaveOperation).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ expectedRevision: 1, idempotencyKey: 'save-1' })
        );
        expect(requestReactionRoleDeleteOperation).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ expectedRevision: 1, idempotencyKey: 'delete-1' })
        );
    });
});

function createWebConfig(): WebConfig {
    return {
        appEnv: 'production',
        fluxerBotToken: 'bot-token',
        guildDefconOverride: 'auto',
        logLevel: 'info',
        nodeEnv: 'test',
    };
}

function createMessage(): NeonFluxDb.ReactionRoleMessageRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        channelId: 'channel-1',
        createdAt: now,
        enabled: true,
        generateOverview: false,
        guildId: 'guild-1',
        id: 'menu-1',
        kind: 'reaction_role',
        lifecycle: 'ready',
        messageContent: 'Choose',
        messageEmbeds: [],
        messageId: 'message-1',
        mode: 'normal',
        pendingOperationId: null,
        revision: 1,
        source: 'dashboard',
        staleAt: null,
        updatedAt: now,
    };
}

function createOption(): NeonFluxDb.ReactionRoleOptionRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        createdAt: now,
        emojiKey: '✅',
        id: 'option-1',
        position: 0,
        reactionRoleMessageId: 'menu-1',
        roleId: 'role-1',
        updatedAt: now,
    };
}

function createOperation(type: 'delete' | 'publish' | 'save'): NeonFluxDb.ReactionRoleOperationRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        actorUserId: 'actor-1',
        attemptCount: 0,
        blockedCount: 0,
        channelId: 'channel-1',
        completedAt: null,
        createdAt: now,
        desiredConfig: {
            enabled: true,
            generateOverview: false,
            messageContent: 'Choose',
            messageEmbeds: [],
            mode: 'normal',
            options: [{ emojiKey: '✅', position: 0, roleId: 'role-1' }],
        },
        errorCode: null,
        expectedRevision: type === 'publish' ? null : 1,
        externalMessageId: type === 'publish' ? null : 'message-1',
        failureCount: 0,
        guildId: 'guild-1',
        id: `operation-${type}`,
        idempotencyKey: `${type}-1`,
        leaseExpiresAt: null,
        leaseId: null,
        leaseOwner: null,
        nextAttemptAt: null,
        processedCount: 0,
        reactionRoleMessageId: type === 'publish' ? null : 'menu-1',
        requestHash: 'hash',
        sendStartedAt: null,
        snapshotComplete: type === 'publish',
        snapshotCursor: null,
        stage: type === 'publish' ? 'send' : 'snapshot',
        status: 'queued',
        succeededCount: 0,
        totalCount: 0,
        type,
        updatedAt: now,
    };
}
