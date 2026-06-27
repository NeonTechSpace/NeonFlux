import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    deleteVerificationFlow,
    listVerificationFlowsByGuildId,
    recordBotActionEvent,
    upsertVerificationFlow,
} from '@neonflux/db';
import type { VerificationFlowRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    deleteDashboardVerificationFlow,
    loadDashboardVerificationSettings,
    updateDashboardVerificationFlow,
} from './dashboard-verification.server.js';
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
        deleteVerificationFlow: vi.fn(),
        listVerificationFlowsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertVerificationFlow: vi.fn(),
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

describe('dashboard verification settings', () => {
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
                    createFluxerRole({ id: 'role-1', name: 'Verified', position: 10 }),
                    createFluxerRole({ id: 'everyone', name: '@everyone', position: 0 }),
                ],
                channels: [
                    {
                        id: 'channel-1',
                        name: 'verify',
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
        vi.mocked(listVerificationFlowsByGuildId).mockResolvedValue(ok([createVerificationFlowRecord()]));
        vi.mocked(upsertVerificationFlow).mockResolvedValue(ok(createVerificationFlowRecord()));
        vi.mocked(deleteVerificationFlow).mockResolvedValue(ok(createVerificationFlowRecord()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads configured verification flows with role and channel labels', async () => {
        const result = await loadDashboardVerificationSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            structureReadStatus: 'available',
            roles: [{ id: 'role-1', name: 'Verified', position: 10 }],
            channels: [{ id: 'channel-1', name: 'verify', type: 0, position: 1 }],
            flows: [
                {
                    id: 'verification-flow-1',
                    channelId: 'channel-1',
                    channelName: 'verify',
                    messageId: 'message-1',
                    emojiKey: 'unicode:check',
                    verifiedRoleId: 'role-1',
                    verifiedRoleName: 'Verified',
                    enabled: true,
                    updatedAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        expect(listVerificationFlowsByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('loads saved settings when the web service has no bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await loadDashboardVerificationSettings(request, 'guild-1');

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

        const result = await updateDashboardVerificationFlow(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            emojiKey: 'unicode:check',
            verifiedRoleId: 'role-1',
        });

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(upsertVerificationFlow).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates flows through the authorized guild scope and records audit', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });

        const result = await updateDashboardVerificationFlow(request, {
            guildId: 'requested-guild',
            channelId: ' channel-1 ',
            messageId: ' message-1 ',
            emojiKey: ' unicode:check ',
            verifiedRoleId: ' role-1 ',
            enabled: false,
        });

        expect(result).toMatchObject({
            type: 'updated',
            flow: {
                messageId: 'message-1',
                verifiedRoleName: 'Verified',
            },
        });
        expect(upsertVerificationFlow).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                channelId: ' channel-1 ',
                messageId: ' message-1 ',
                emojiKey: ' unicode:check ',
                verifiedRoleId: ' role-1 ',
                enabled: false,
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'verification',
                action: 'flow.updated',
                actorUserId: 'actor-1',
                targetId: 'message-1',
                metadata: {
                    channelId: 'channel-1',
                    channelName: 'verify',
                    messageId: 'message-1',
                    emojiKey: 'unicode:check',
                    verifiedRoleId: 'role-1',
                    verifiedRoleName: 'Verified',
                    enabled: true,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('deletes flows and records dashboard audit events', async () => {
        const result = await deleteDashboardVerificationFlow(request, {
            guildId: 'guild-1',
            messageId: 'message-1',
        });

        expect(result).toMatchObject({
            type: 'deleted',
            flow: {
                messageId: 'message-1',
            },
        });
        expect(deleteVerificationFlow).toHaveBeenCalledWith({}, { guildId: 'guild-1', messageId: 'message-1' });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'verification',
                action: 'flow.deleted',
                targetId: 'message-1',
            })
        );
    });

    it('maps repository validation failures to invalid-input', async () => {
        vi.mocked(upsertVerificationFlow).mockResolvedValueOnce(err({ type: 'missing-input', field: 'emojiKey' }));

        const result = await updateDashboardVerificationFlow(request, {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            emojiKey: '',
            verifiedRoleId: 'role-1',
        });

        expect(result).toStrictEqual({ type: 'invalid-input', field: 'emojiKey' });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
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

function createVerificationFlowRecord(overrides: Partial<VerificationFlowRecord> = {}): VerificationFlowRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'verification-flow-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'message-1',
        emojiKey: 'unicode:check',
        verifiedRoleId: 'role-1',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'verification',
        action: 'flow.updated',
        actorUserId: 'actor-1',
        targetId: 'message-1',
        metadata: {
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}
