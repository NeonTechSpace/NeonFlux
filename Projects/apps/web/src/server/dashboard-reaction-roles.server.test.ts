import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    deleteReactionRoleMessage,
    deleteReactionRoleOptionByMessage,
    listReactionRoleMessagesByGuildId,
    recordBotActionEvent,
    upsertReactionRoleMessage,
    upsertReactionRoleOptionByMessage,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    deleteDashboardReactionRoleMessage,
    deleteDashboardReactionRoleOption,
    loadDashboardReactionRolesSettings,
    updateDashboardReactionRoleMessage,
    updateDashboardReactionRoleOption,
} from './dashboard-reaction-roles.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/access');
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
        deleteReactionRoleMessage: vi.fn(),
        deleteReactionRoleOptionByMessage: vi.fn(),
        listReactionRoleMessagesByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertReactionRoleMessage: vi.fn(),
        upsertReactionRoleOptionByMessage: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

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

describe('dashboard reaction roles', () => {
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
                    createFluxerRole({ id: 'role-1', name: 'Member', position: 10 }),
                    createFluxerRole({ id: 'everyone', name: '@everyone', position: 0 }),
                ],
                channels: [
                    {
                        id: 'channel-1',
                        name: 'roles',
                        type: 0,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                    {
                        id: 'voice-1',
                        name: 'Voice',
                        type: 2,
                        parentId: null,
                        position: 2,
                        permissionOverwrites: [],
                    },
                ],
                categories: [],
            })
        );
        vi.mocked(listReactionRoleMessagesByGuildId).mockResolvedValue(
            ok([
                {
                    ...createReactionRoleMessageRecord(),
                    options: [createReactionRoleOptionRecord()],
                },
            ])
        );
        vi.mocked(upsertReactionRoleMessage).mockResolvedValue(ok(createReactionRoleMessageRecord()));
        vi.mocked(upsertReactionRoleOptionByMessage).mockResolvedValue(ok(createReactionRoleOptionRecord()));
        vi.mocked(deleteReactionRoleOptionByMessage).mockResolvedValue(ok(createReactionRoleOptionRecord()));
        vi.mocked(deleteReactionRoleMessage).mockResolvedValue(ok(createReactionRoleMessageRecord()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads configured reaction-role messages with role and channel labels', async () => {
        const result = await loadDashboardReactionRolesSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            structureReadStatus: 'available',
            roles: [{ id: 'role-1', name: 'Member', position: 10 }],
            channels: [{ id: 'channel-1', name: 'roles', type: 0, position: 1 }],
            messages: [
                {
                    id: 'reaction-role-message-1',
                    channelId: 'channel-1',
                    channelName: 'roles',
                    messageId: 'message-1',
                    removeOnUnreact: true,
                    enabled: true,
                    updatedAt: '2026-06-26T00:00:00.000Z',
                    options: [
                        {
                            id: 'reaction-role-option-1',
                            emojiKey: 'unicode:check',
                            roleId: 'role-1',
                            roleName: 'Member',
                        },
                    ],
                },
            ],
        });
        expect(listReactionRoleMessagesByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('loads saved settings when the web service has no bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await loadDashboardReactionRolesSettings(request, 'guild-1');

        expect(result).toMatchObject({
            type: 'settings',
            structureReadStatus: 'bot-token-missing',
            roles: [],
            channels: [],
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('denies unavailable or unauthorized guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await updateDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
        });

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(upsertReactionRoleMessage).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates messages through the authorized guild scope and records audit', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });

        const result = await updateDashboardReactionRoleMessage(request, {
            guildId: 'requested-guild',
            channelId: ' channel-1 ',
            messageId: ' message-1 ',
            enabled: false,
            removeOnUnreact: false,
        });

        expect(result).toMatchObject({
            type: 'updated',
            message: {
                messageId: 'message-1',
            },
        });
        expect(upsertReactionRoleMessage).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                channelId: ' channel-1 ',
                messageId: ' message-1 ',
                enabled: false,
                removeOnUnreact: false,
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'reaction_roles',
                action: 'message.updated',
                actorUserId: 'actor-1',
                targetId: 'message-1',
                metadata: {
                    channelId: 'channel-1',
                    channelName: 'roles',
                    messageId: 'message-1',
                    removeOnUnreact: true,
                    enabled: true,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('updates options and maps missing message errors', async () => {
        const updated = await updateDashboardReactionRoleOption(request, {
            guildId: 'guild-1',
            messageId: 'message-1',
            emojiKey: 'unicode:check',
            roleId: 'role-1',
        });

        vi.mocked(upsertReactionRoleOptionByMessage).mockResolvedValueOnce(err({ type: 'not-found' }));

        const missing = await updateDashboardReactionRoleOption(request, {
            guildId: 'guild-1',
            messageId: 'missing-message',
            emojiKey: 'unicode:check',
            roleId: 'role-1',
        });

        expect(updated).toStrictEqual({
            type: 'updated',
            option: {
                id: 'reaction-role-option-1',
                emojiKey: 'unicode:check',
                roleId: 'role-1',
                roleName: 'Member',
            },
        });
        expect(missing).toStrictEqual({ type: 'not-found' });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'reaction_roles',
                action: 'option.updated',
                targetId: 'message-1',
            })
        );
    });

    it('deletes options and messages with audit events', async () => {
        const deletedOption = await deleteDashboardReactionRoleOption(request, {
            guildId: 'guild-1',
            messageId: 'message-1',
            emojiKey: 'unicode:check',
        });
        const deletedMessage = await deleteDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            messageId: 'message-1',
        });

        expect(deletedOption).toStrictEqual({
            type: 'deleted',
            option: {
                id: 'reaction-role-option-1',
                emojiKey: 'unicode:check',
                roleId: 'role-1',
                roleName: 'Member',
            },
        });
        expect(deletedMessage).toMatchObject({
            type: 'deleted',
            message: {
                messageId: 'message-1',
            },
        });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'reaction_roles',
                action: 'option.deleted',
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'reaction_roles',
                action: 'message.deleted',
            })
        );
    });

    it('returns database-error when audit recording fails after a write', async () => {
        vi.mocked(recordBotActionEvent).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await updateDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
        });

        expect(result).toStrictEqual({ type: 'database-error' });
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

function createFluxerRole(overrides: { id: string; name: string; position: number }) {
    return {
        color: 0,
        permissions: '0',
        hoist: false,
        mentionable: false,
        ...overrides,
    };
}

function createReactionRoleMessageRecord() {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'reaction-role-message-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'message-1',
        kind: 'reaction_role',
        removeOnUnreact: true,
        enabled: true,
        staleAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function createReactionRoleOptionRecord() {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'reaction-role-option-1',
        reactionRoleMessageId: 'reaction-role-message-1',
        emojiKey: 'unicode:check',
        roleId: 'role-1',
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'reaction_roles',
        action: 'message.updated',
        actorUserId: 'actor-1',
        targetId: 'message-1',
        metadata: {
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}
