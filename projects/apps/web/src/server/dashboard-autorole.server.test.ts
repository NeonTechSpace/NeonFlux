import { loadWebConfig } from '@neonflux/config';
import type * as NeonFluxConfig from '@neonflux/config';
import { deleteAutoroleRule, listAutoroleRulesByGuildId, recordBotActionEvent, upsertAutoroleRule } from '@neonflux/db';
import type { AutoroleRuleRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as NeonFluxFluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    deleteDashboardAutoroleRule,
    loadDashboardAutoroleSettings,
    updateDashboardAutoroleRule,
} from './dashboard-autorole.server.js';
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
    accessTokenExpiresAt: new Date('2026-06-26T12:00:00.000Z'),
};

vi.mock('@neonflux/config', async (importActual) => {
    const actual = await importActual<typeof NeonFluxConfig>();

    return {
        ...actual,
        loadWebConfig: vi.fn(),
    };
});

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

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        deleteAutoroleRule: vi.fn(),
        listAutoroleRulesByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertAutoroleRule: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof NeonFluxFluxer>();

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

describe('dashboard autorole settings', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue({
            appEnv: 'development',
            databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
            autoMigrate: true,
            guildDefconOverride: 'auto',
            logLevel: 'info',
            nodeEnv: 'test',
            fluxerBotToken: 'bot-token',
        });
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
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
        vi.mocked(listAutoroleRulesByGuildId).mockResolvedValue(ok([createRule()]));
        vi.mocked(upsertAutoroleRule).mockResolvedValue(ok(createRule()));
        vi.mocked(deleteAutoroleRule).mockResolvedValue(ok(createRule()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(
            ok({
                guildId: 'authorized-guild',
                roles: [
                    {
                        id: 'role-1',
                        name: 'Member',
                        position: 10,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                    {
                        id: 'authorized-guild',
                        name: '@everyone',
                        position: 0,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                channels: [],
                categories: [],
            })
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads rules and bot-readable roles through the authorized guild scope', async () => {
        const result = await loadDashboardAutoroleSettings(request, 'requested-guild');

        expect(result).toStrictEqual({
            type: 'settings',
            roleReadStatus: 'available',
            roles: [
                {
                    id: 'role-1',
                    name: 'Member',
                    position: 10,
                },
            ],
            rules: [
                {
                    id: 'autorole-rule-1',
                    roleId: 'role-1',
                    name: 'Member',
                    enabled: true,
                    updatedAt: '2026-06-26T10:01:00.000Z',
                },
            ],
        });
        expect(listAutoroleRulesByGuildId).toHaveBeenCalledWith({}, { guildId: 'authorized-guild' });
        expect(readFluxerBotGuildStructure).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
        });
    });

    it('returns saved rules when role reads are unavailable', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce({
            appEnv: 'development',
            databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
            autoMigrate: true,
            guildDefconOverride: 'auto',
            logLevel: 'info',
            nodeEnv: 'test',
        });

        await expect(loadDashboardAutoroleSettings(request, 'guild-1')).resolves.toMatchObject({
            type: 'settings',
            roleReadStatus: 'bot-token-missing',
            roles: [],
        });
    });

    it('does not read or write when the guild is inaccessible', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        await expect(loadDashboardAutoroleSettings(request, 'guild-1')).resolves.toStrictEqual({
            type: 'auth-required',
        });
        expect(listAutoroleRulesByGuildId).not.toHaveBeenCalled();

        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(
            updateDashboardAutoroleRule(request, {
                guildId: 'guild-1',
                roleId: 'role-1',
            })
        ).resolves.toStrictEqual({ type: 'not-found' });
        expect(upsertAutoroleRule).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates an autorole rule and records a dashboard audit event', async () => {
        vi.mocked(upsertAutoroleRule).mockResolvedValueOnce(ok(createRule({ enabled: false })));

        const result = await updateDashboardAutoroleRule(request, {
            guildId: 'requested-guild',
            roleId: 'role-1',
            name: 'Member',
            enabled: false,
        });

        expect(result).toStrictEqual({
            type: 'updated',
            rule: {
                id: 'autorole-rule-1',
                roleId: 'role-1',
                name: 'Member',
                enabled: false,
                updatedAt: '2026-06-26T10:01:00.000Z',
            },
        });
        expect(upsertAutoroleRule).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                roleId: 'role-1',
                name: 'Member',
                enabled: false,
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'autorole',
                action: 'rule.updated',
                actorUserId: 'actor-1',
                targetId: 'role-1',
                metadata: {
                    roleId: 'role-1',
                    roleName: 'Member',
                    enabled: false,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('deletes an autorole rule and records a dashboard audit event', async () => {
        const result = await deleteDashboardAutoroleRule(request, {
            guildId: 'requested-guild',
            roleId: 'role-1',
        });

        expect(result.type).toBe('deleted');
        expect(deleteAutoroleRule).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                roleId: 'role-1',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'autorole',
                action: 'rule.deleted',
                actorUserId: 'actor-1',
                targetId: 'role-1',
                metadata: {
                    roleId: 'role-1',
                    roleName: 'Member',
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('maps repository validation failures to invalid-input', async () => {
        vi.mocked(upsertAutoroleRule).mockResolvedValueOnce(err({ type: 'missing-input', field: 'roleId' }));

        await expect(
            updateDashboardAutoroleRule(request, {
                guildId: 'requested-guild',
                roleId: '',
            })
        ).resolves.toStrictEqual({
            type: 'invalid-input',
            field: 'roleId',
        });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });
});

function createRule(overrides: Partial<AutoroleRuleRecord> = {}): AutoroleRuleRecord {
    return {
        id: 'autorole-rule-1',
        guildId: 'authorized-guild',
        roleId: 'role-1',
        name: 'Member',
        enabled: true,
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
        updatedAt: new Date('2026-06-26T10:01:00.000Z'),
        ...overrides,
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-1',
        guildId: 'authorized-guild',
        feature: 'autorole',
        action: 'rule.updated',
        actorUserId: 'actor-1',
        targetId: 'role-1',
        metadata: {},
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
    };
}
