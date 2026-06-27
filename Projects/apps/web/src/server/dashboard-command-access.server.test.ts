import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    deleteGuildCommandPermissionRule,
    listGuildCommandPermissionRulesByGuildId,
    recordBotActionEvent,
    upsertGuildCommandPermissionRule,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    deleteDashboardCommandAccessRule,
    loadDashboardCommandAccessPage,
    updateDashboardCommandAccessRule,
} from './dashboard-command-access.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
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
        deleteGuildCommandPermissionRule: vi.fn(),
        listGuildCommandPermissionRulesByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertGuildCommandPermissionRule: vi.fn(),
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

describe('dashboard command access', () => {
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
        vi.mocked(listGuildCommandPermissionRulesByGuildId).mockResolvedValue(ok([createCommandRule()]));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure()));
        vi.mocked(upsertGuildCommandPermissionRule).mockResolvedValue(ok(createCommandRule()));
        vi.mocked(deleteGuildCommandPermissionRule).mockResolvedValue(ok(createCommandRule()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads the grantable command catalog and scoped rules', async () => {
        const result = await loadDashboardCommandAccessPage(request, 'requested-guild');

        expect(result.type).toBe('access');

        if (result.type !== 'access') {
            throw new Error(`Expected access result, received ${result.type}`);
        }

        expect(result.catalog.categories).toStrictEqual([
            { id: 'settings', title: 'Settings' },
            { id: 'moderation', title: 'Moderation' },
        ]);
        expect(
            result.catalog.commands.map((command) => ({ id: command.id, categoryId: command.categoryId }))
        ).toStrictEqual([
            { id: 'settings.prefix', categoryId: 'settings' },
            { id: 'moderation.warn', categoryId: 'moderation' },
            { id: 'moderation.kick', categoryId: 'moderation' },
            { id: 'moderation.ban', categoryId: 'moderation' },
            { id: 'moderation.unban', categoryId: 'moderation' },
            { id: 'moderation.timeout', categoryId: 'moderation' },
            { id: 'moderation.untimeout', categoryId: 'moderation' },
            { id: 'moderation.purge', categoryId: 'moderation' },
            { id: 'moderation.warnings', categoryId: 'moderation' },
            { id: 'moderation.warning.delete', categoryId: 'moderation' },
            { id: 'moderation.warnings.clear', categoryId: 'moderation' },
            { id: 'moderation.case', categoryId: 'moderation' },
            { id: 'moderation.cases', categoryId: 'moderation' },
            { id: 'moderation.reason', categoryId: 'moderation' },
            { id: 'moderation.note', categoryId: 'moderation' },
            { id: 'moderation.notes', categoryId: 'moderation' },
        ]);
        expect(result.rules).toStrictEqual([
            {
                targetType: 'command',
                targetId: 'settings.prefix',
                userIds: ['user-a'],
                roleIds: ['role-a'],
                updatedAt: '2026-06-24T00:00:00.000Z',
            },
        ]);
        expect(result.roles).toStrictEqual([
            {
                id: 'role-a',
                name: 'Moderator',
                position: 4,
            },
            {
                id: 'role-b',
                name: 'Helper',
                position: 2,
            },
        ]);
        expect(result.roleReadStatus).toBe('available');
        expect(listGuildCommandPermissionRulesByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
        expect(readFluxerBotGuildStructure).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
        });
    });

    it('loads command access even when the web service cannot read roles', async () => {
        const config = createWebConfig();

        delete config.fluxerBotToken;
        vi.mocked(loadWebConfig).mockReturnValueOnce(config);

        const result = await loadDashboardCommandAccessPage(request, 'requested-guild');

        expect(result).toMatchObject({
            type: 'access',
            roles: [],
            roleReadStatus: 'bot-token-missing',
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('does not read or write when the guild is inaccessible', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'not-found' });

        await expect(loadDashboardCommandAccessPage(request, 'guild-1')).resolves.toStrictEqual({ type: 'not-found' });
        expect(listGuildCommandPermissionRulesByGuildId).not.toHaveBeenCalled();

        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(
            updateDashboardCommandAccessRule(request, {
                guildId: 'guild-1',
                targetType: 'command',
                targetId: 'settings.prefix',
            })
        ).resolves.toStrictEqual({ type: 'not-found' });
        expect(upsertGuildCommandPermissionRule).not.toHaveBeenCalled();
    });

    it('rejects targets that are not implemented grantable bot commands', async () => {
        const result = await updateDashboardCommandAccessRule(request, {
            guildId: 'guild-1',
            targetType: 'command',
            targetId: 'suggestions.suggest',
            roleIds: ['role-a'],
        });

        expect(result).toStrictEqual({ type: 'invalid-target' });
        expect(upsertGuildCommandPermissionRule).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates command grants and records a dashboard audit event', async () => {
        const result = await updateDashboardCommandAccessRule(request, {
            guildId: 'guild-1',
            targetType: 'command',
            targetId: ' settings.prefix ',
            userIds: [' user-a ', ''],
            roleIds: ['role-a'],
        });

        expect(result).toMatchObject({
            type: 'updated',
            rule: {
                targetType: 'command',
                targetId: 'settings.prefix',
            },
        });
        expect(upsertGuildCommandPermissionRule).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                targetType: 'command',
                targetId: 'settings.prefix',
                userIds: [' user-a ', ''],
                roleIds: ['role-a'],
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                feature: 'access',
                action: 'command_access.updated',
                actorUserId: 'actor-1',
                targetId: 'settings.prefix',
                metadata: {
                    targetType: 'command',
                    targetId: 'settings.prefix',
                    userCount: 1,
                    roleCount: 1,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('deletes command grants and records a dashboard audit event', async () => {
        const result = await deleteDashboardCommandAccessRule(request, {
            guildId: 'guild-1',
            targetType: 'command',
            targetId: 'settings.prefix',
        });

        expect(result).toStrictEqual({
            type: 'deleted',
            targetType: 'command',
            targetId: 'settings.prefix',
        });
        expect(deleteGuildCommandPermissionRule).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                targetType: 'command',
                targetId: 'settings.prefix',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'access',
                action: 'command_access.deleted',
                actorUserId: 'actor-1',
                targetId: 'settings.prefix',
            })
        );
    });
});

function createCommandRule() {
    return {
        guildId: 'guild-1',
        targetType: 'command' as const,
        targetId: 'settings.prefix',
        userIds: ['user-a'],
        roleIds: ['role-a'],
        createdAt: new Date('2026-06-24T00:00:00.000Z'),
        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
    };
}

function createWebConfig(overrides: Partial<WebConfig> = {}): WebConfig {
    return {
        appEnv: 'development',
        databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
        autoMigrate: true,
        guildDefconOverride: 'auto',
        logLevel: 'info',
        nodeEnv: 'test',
        sessionSecret: 'test-secret',
        fluxerAppId: 'client-id',
        fluxerClientSecret: 'client-secret',
        fluxerOauthRedirectUrl: 'http://localhost:3000/auth/fluxer/callback',
        fluxerTokenEncryptionKey: 'test-encryption-key',
        fluxerBotToken: 'bot-token',
        ...overrides,
    };
}

function createFluxerStructure() {
    return {
        guildId: 'guild-1',
        roles: [
            {
                id: 'role-b',
                name: 'Helper',
                position: 2,
                color: 0,
                permissions: '0',
                hoist: false,
                mentionable: false,
            },
            {
                id: 'role-a',
                name: 'Moderator',
                position: 4,
                color: 0,
                permissions: '0',
                hoist: false,
                mentionable: false,
            },
            {
                id: 'guild-1',
                name: '@everyone',
                position: 0,
                color: 0,
                permissions: '0',
                hoist: false,
                mentionable: false,
            },
        ],
        categories: [],
        channels: [],
    };
}

function createAuditEventRecord() {
    return {
        id: 'event-1',
        guildId: 'guild-1',
        feature: 'access',
        action: 'command_access.updated',
        actorUserId: 'actor-1',
        targetId: 'settings.prefix',
        metadata: {},
        createdAt: new Date('2026-06-24T00:00:00.000Z'),
    };
}
