import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    deleteReactionRoleMessage,
    deleteReactionRoleOptionByMessage,
    findReactionRoleMessage,
    listReactionRoleMessagesByGuildId,
    recordBotActionEvent,
    upsertReactionRoleMessage,
    upsertReactionRoleOptionByMessage,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import {
    editFluxerBotGuildChannelMessage,
    reactFluxerBotGuildChannelMessage,
    removeFluxerBotGuildChannelMessageReactionEmoji,
    readFluxerBotGuildEmojis,
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
    deleteDashboardReactionRoleMessage,
    loadDashboardReactionRolesSettings,
    publishDashboardReactionRoleMessage,
    saveDashboardReactionRoleMessage,
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
        findReactionRoleMessage: vi.fn(),
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
        editFluxerBotGuildChannelMessage: vi.fn(),
        reactFluxerBotGuildChannelMessage: vi.fn(),
        removeFluxerBotGuildChannelMessageReactionEmoji: vi.fn(),
        readFluxerBotGuildEmojis: vi.fn(),
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
        vi.mocked(readFluxerBotGuildEmojis).mockResolvedValue(
            ok([
                {
                    id: 'emoji-1',
                    guildId: 'guild-1',
                    name: 'party',
                    animated: false,
                    identifier: 'party:emoji-1',
                    url: 'https://cdn.example/party.webp',
                },
            ])
        );
        vi.mocked(sendFluxerBotGuildChannelMessage).mockResolvedValue(
            ok({
                id: 'message-1',
                channelId: 'channel-1',
                guildId: 'guild-1',
            })
        );
        vi.mocked(editFluxerBotGuildChannelMessage).mockResolvedValue(
            ok({
                id: 'message-1',
                channelId: 'channel-1',
                guildId: 'guild-1',
            })
        );
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValue(ok(undefined));
        vi.mocked(removeFluxerBotGuildChannelMessageReactionEmoji).mockResolvedValue(ok(undefined));
        vi.mocked(listReactionRoleMessagesByGuildId).mockResolvedValue(
            ok([
                {
                    ...createReactionRoleMessageRecord(),
                    options: [createReactionRoleOptionRecord()],
                },
            ])
        );
        vi.mocked(findReactionRoleMessage).mockResolvedValue(ok(createReactionRoleMessageRecord()));
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
            emojiReadStatus: 'available',
            roles: [{ id: 'role-1', name: 'Member', position: 10, color: 0 }],
            channels: [{ id: 'channel-1', name: 'roles', type: 0, position: 1 }],
            emojis: [
                {
                    key: 'party:emoji-1',
                    label: ':party:',
                    name: 'party',
                    custom: true,
                    animated: false,
                    id: 'emoji-1',
                    url: 'https://cdn.example/party.webp',
                },
            ],
            messages: [
                {
                    id: 'reaction-role-message-1',
                    channelId: 'channel-1',
                    channelName: 'roles',
                    messageId: 'message-1',
                    mode: 'normal',
                    source: 'existing',
                    messageEmbeds: [],
                    generateOverview: false,
                    enabled: true,
                    updatedAt: '2026-06-26T00:00:00.000Z',
                    options: [
                        {
                            id: 'reaction-role-option-1',
                            emojiKey: 'unicode:check',
                            roleId: 'role-1',
                            roleName: 'Member',
                            roleColor: 0,
                            position: 0,
                        },
                    ],
                },
            ],
        });
        expect(listReactionRoleMessagesByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('loads saved settings when the web service has no bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValue(createWebConfig({ fluxerBotToken: undefined }));

        const result = await loadDashboardReactionRolesSettings(request, 'guild-1');

        expect(result).toMatchObject({
            type: 'settings',
            structureReadStatus: 'bot-token-missing',
            emojiReadStatus: 'bot-token-missing',
            roles: [],
            channels: [],
            emojis: [],
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('denies unavailable or unauthorized guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await publishDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'Pick roles',
            embeds: [],
            mode: 'normal',
            generateOverview: false,
            options: [],
        });

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
        expect(upsertReactionRoleMessage).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('publishes a dashboard-built reaction-role menu, stores options, seeds reactions, and records audit', async () => {
        const result = await publishDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'Pick roles:\n{list}',
            embeds: [],
            mode: 'exclusive',
            generateOverview: true,
            options: [
                {
                    emojiKey: '✅',
                    emojiLabel: '✅',
                    roleId: 'role-1',
                    position: 0,
                },
            ],
        });

        expect(result).toMatchObject({ type: 'published', seedFailures: [] });
        expect(sendFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'Pick roles:\n✅ - <@&role-1> (Member)',
        });
        expect(upsertReactionRoleMessage).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
                mode: 'exclusive',
                source: 'dashboard',
                messageContent: 'Pick roles:\n✅ - <@&role-1> (Member)',
                messageEmbeds: [],
                generateOverview: true,
                enabled: true,
            }
        );
        expect(upsertReactionRoleOptionByMessage).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: '✅',
                roleId: 'role-1',
                position: 0,
            }
        );
        expect(reactFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: '✅',
        });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'reaction_roles',
                action: 'message.created',
                targetId: 'message-1',
                metadata: expect.objectContaining({
                    channelId: 'channel-1',
                    channelName: 'roles',
                    messageId: 'message-1',
                    mode: 'exclusive',
                    optionCount: 1,
                    generateOverview: true,
                    seedFailureCount: 0,
                }),
            })
        );
    });

    it('publishes embed menus and records seed failures without blocking the saved menu', async () => {
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValueOnce(
            err({ type: 'react-failed', error: new Error('missing permission') })
        );

        const result = await publishDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            embeds: [{ title: 'Roles', description: '{list}' }],
            mode: 'normal',
            generateOverview: true,
            options: [
                {
                    emojiKey: 'party:emoji-1',
                    emojiLabel: ':party:',
                    roleId: 'role-1',
                    position: 0,
                },
            ],
        });

        expect(result).toMatchObject({ type: 'published-with-seed-errors', seedFailures: ['party:emoji-1'] });
        expect(sendFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            channelId: 'channel-1',
            embeds: [{ title: 'Roles', description: ':party: - <@&role-1> (Member)' }],
        });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                action: 'reaction_seed.failed',
                metadata: expect.objectContaining({
                    failedEmojiKeys: 'party:emoji-1',
                }),
            })
        );
    });

    it('rejects menus over the Fluxer reaction limit before sending', async () => {
        const result = await publishDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'Too many',
            embeds: [],
            mode: 'normal',
            generateOverview: false,
            options: Array.from({ length: 31 }, (_, index) => ({
                emojiKey: `emoji-${index}`,
                emojiLabel: `emoji-${index}`,
                roleId: 'role-1',
                position: index,
            })),
        });

        expect(result).toStrictEqual({
            type: 'invalid-input',
            field: 'options',
            message: 'Reaction-role messages support up to 30 options.',
        });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
    });

    it('deletes reaction-role messages with audit events', async () => {
        const result = await deleteDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            messageId: 'message-1',
        });

        expect(result).toMatchObject({
            type: 'deleted',
            message: {
                messageId: 'message-1',
            },
        });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'reaction_roles',
                action: 'message.deleted',
                targetId: 'message-1',
            })
        );
    });

    it('saves existing menus by editing Fluxer first, then persisting message and option diffs', async () => {
        vi.mocked(listReactionRoleMessagesByGuildId)
            .mockResolvedValueOnce(
                ok([
                    {
                        ...createReactionRoleMessageRecord(),
                        options: [
                            createReactionRoleOptionRecord({ emojiKey: 'unicode:check', position: 0 }),
                            createReactionRoleOptionRecord({ emojiKey: '❌', position: 1 }),
                        ],
                    },
                ])
            )
            .mockResolvedValueOnce(
                ok([
                    {
                        ...createReactionRoleMessageRecord(),
                        mode: 'exclusive',
                        messageContent: 'Pick roles:\nunicode:check - <@&role-1> (Member)\n⭐ - <@&role-1> (Member)',
                        generateOverview: true,
                        options: [
                            createReactionRoleOptionRecord({ emojiKey: 'unicode:check', position: 0 }),
                            createReactionRoleOptionRecord({ emojiKey: '⭐', position: 1 }),
                        ],
                    },
                ])
            );

        const result = await saveDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            messageId: 'message-1',
            content: 'Pick roles:\n{list}',
            embeds: [],
            mode: 'exclusive',
            generateOverview: true,
            options: [
                {
                    emojiKey: 'unicode:check',
                    emojiLabel: 'unicode:check',
                    roleId: 'role-1',
                    position: 0,
                },
                {
                    emojiKey: '⭐',
                    emojiLabel: '⭐',
                    roleId: 'role-1',
                    position: 1,
                },
            ],
        });

        expect(result).toMatchObject({ type: 'saved', seedFailures: [], cleanupFailures: [] });
        expect(editFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            content: 'Pick roles:\nunicode:check - <@&role-1> (Member)\n⭐ - <@&role-1> (Member)',
        });
        expect(vi.mocked(editFluxerBotGuildChannelMessage).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(upsertReactionRoleMessage).mock.invocationCallOrder[0]
        );
        expect(upsertReactionRoleMessage).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
                mode: 'exclusive',
                messageContent: 'Pick roles:\nunicode:check - <@&role-1> (Member)\n⭐ - <@&role-1> (Member)',
                generateOverview: true,
            })
        );
        expect(upsertReactionRoleOptionByMessage).toHaveBeenCalledTimes(2);
        expect(deleteReactionRoleOptionByMessage).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: '❌',
            }
        );
        expect(reactFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: '⭐',
        });
        expect(removeFluxerBotGuildChannelMessageReactionEmoji).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: '❌',
        });
    });

    it('does not persist option changes when Fluxer message editing fails', async () => {
        vi.mocked(editFluxerBotGuildChannelMessage).mockResolvedValueOnce(
            err({ type: 'edit-failed', error: new Error('missing permission') })
        );

        const result = await saveDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            messageId: 'message-1',
            content: 'Pick roles',
            embeds: [],
            mode: 'normal',
            generateOverview: false,
            options: [
                {
                    emojiKey: 'unicode:check',
                    emojiLabel: 'unicode:check',
                    roleId: 'role-1',
                    position: 0,
                },
            ],
        });

        expect(result).toStrictEqual({ type: 'edit-failed' });
        expect(upsertReactionRoleMessage).not.toHaveBeenCalled();
        expect(upsertReactionRoleOptionByMessage).not.toHaveBeenCalled();
        expect(deleteReactionRoleOptionByMessage).not.toHaveBeenCalled();
    });

    it('saves existing menus with reaction sync warnings and audit events', async () => {
        vi.mocked(listReactionRoleMessagesByGuildId)
            .mockResolvedValueOnce(
                ok([
                    {
                        ...createReactionRoleMessageRecord(),
                        options: [
                            createReactionRoleOptionRecord({ emojiKey: 'unicode:check', position: 0 }),
                            createReactionRoleOptionRecord({ emojiKey: '❌', position: 1 }),
                        ],
                    },
                ])
            )
            .mockResolvedValueOnce(
                ok([
                    {
                        ...createReactionRoleMessageRecord(),
                        options: [
                            createReactionRoleOptionRecord({ emojiKey: 'unicode:check', position: 0 }),
                            createReactionRoleOptionRecord({ emojiKey: '⭐', position: 1 }),
                        ],
                    },
                ])
            );
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValueOnce(
            err({ type: 'react-failed', error: new Error('missing permission') })
        );
        vi.mocked(removeFluxerBotGuildChannelMessageReactionEmoji).mockResolvedValueOnce(
            err({ type: 'remove-reaction-failed', error: new Error('missing permission') })
        );

        const result = await saveDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
            messageId: 'message-1',
            content: 'Pick roles',
            embeds: [],
            mode: 'normal',
            generateOverview: false,
            options: [
                {
                    emojiKey: 'unicode:check',
                    emojiLabel: 'unicode:check',
                    roleId: 'role-1',
                    position: 0,
                },
                {
                    emojiKey: '⭐',
                    emojiLabel: '⭐',
                    roleId: 'role-1',
                    position: 1,
                },
            ],
        });

        expect(result).toMatchObject({
            type: 'saved-with-reaction-errors',
            seedFailures: ['⭐'],
            cleanupFailures: ['❌'],
        });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'reaction_roles',
                action: 'reaction_seed.failed',
                targetId: 'message-1',
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'reaction_roles',
                action: 'reaction_cleanup.failed',
                targetId: 'message-1',
            })
        );
    });

    it('returns database-error when audit recording fails after a write', async () => {
        vi.mocked(recordBotActionEvent).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await deleteDashboardReactionRoleMessage(request, {
            guildId: 'guild-1',
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
        mode: 'normal',
        source: 'existing',
        messageContent: null,
        messageEmbeds: [],
        generateOverview: false,
        enabled: true,
        staleAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function createReactionRoleOptionRecord(
    overrides: {
        id?: string;
        emojiKey?: string;
        roleId?: string;
        position?: number;
    } = {}
) {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: overrides.id ?? 'reaction-role-option-1',
        reactionRoleMessageId: 'reaction-role-message-1',
        emojiKey: overrides.emojiKey ?? 'unicode:check',
        roleId: overrides.roleId ?? 'role-1',
        position: overrides.position ?? 0,
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
