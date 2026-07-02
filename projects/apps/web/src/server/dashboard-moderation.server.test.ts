import {
    findGuildModerationPolicyByGuildId,
    listModerationCasesByGuildId,
    recordBotActionEvent,
    upsertGuildModerationPolicy,
} from '@neonflux/db';
import type { GuildModerationPolicyRecord, ModerationCaseRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { loadDashboardTargetCatalog } from './dashboard-target-catalog.server.js';
import {
    loadDashboardModerationCases,
    loadDashboardModerationPolicy,
    updateDashboardModerationPolicy,
} from './dashboard-moderation.server.js';

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
    accessTokenExpiresAt: new Date('2026-06-26T12:00:00.000Z'),
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

vi.mock('./dashboard-target-catalog.server.js', () => ({
    loadDashboardTargetCatalog: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        findGuildModerationPolicyByGuildId: vi.fn(),
        listModerationCasesByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertGuildModerationPolicy: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', () => ({
    getFluxerCurrentUser: vi.fn(),
}));

describe('loadDashboardModerationCases', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });
        vi.mocked(listModerationCasesByGuildId).mockResolvedValue(
            ok([
                createCase({
                    caseNumber: 2,
                    action: 'ban',
                    status: 'resolved',
                    targetType: 'user',
                    targetUserId: 'target-2',
                    actorUserId: 'mod-1',
                    reason: 'Raid account',
                }),
                createCase({
                    caseNumber: 1,
                    action: 'kick',
                    status: 'void',
                    targetType: 'user',
                    targetUserId: 'target-1',
                    actorUserId: null,
                    reason: null,
                }),
            ])
        );
        vi.mocked(findGuildModerationPolicyByGuildId).mockResolvedValue(err({ type: 'not-found' }));
        vi.mocked(loadDashboardTargetCatalog).mockResolvedValue({
            status: 'available',
            channels: [],
            roles: [{ id: 'role-1', name: 'Moderator', position: 10, color: 0x38bdf8 }],
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
        vi.mocked(upsertGuildModerationPolicy).mockResolvedValue(ok(createPolicy()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads recent cases through the authorized guild scope', async () => {
        const result = await loadDashboardModerationCases(request, 'requested-guild');

        expect(result).toStrictEqual({
            type: 'cases',
            cases: [
                {
                    caseNumber: 2,
                    action: 'ban',
                    status: 'resolved',
                    targetType: 'user',
                    targetUserId: 'target-2',
                    actorUserId: 'mod-1',
                    reason: 'Raid account',
                    createdAt: '2026-06-26T10:00:00.000Z',
                    updatedAt: '2026-06-26T10:01:00.000Z',
                },
                {
                    caseNumber: 1,
                    action: 'kick',
                    status: 'void',
                    targetType: 'user',
                    targetUserId: 'target-1',
                    createdAt: '2026-06-26T10:00:00.000Z',
                    updatedAt: '2026-06-26T10:01:00.000Z',
                },
            ],
        });
        expect(listModerationCasesByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                limit: 50,
            }
        );
    });

    it('denies inaccessible guild states before reading cases', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        await expect(loadDashboardModerationCases(request, 'guild-1')).resolves.toStrictEqual({
            type: 'auth-required',
        });

        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(loadDashboardModerationCases(request, 'guild-1')).resolves.toStrictEqual({ type: 'not-found' });
        expect(listModerationCasesByGuildId).not.toHaveBeenCalled();
    });

    it('maps case read failures to database-error', async () => {
        vi.mocked(listModerationCasesByGuildId).mockResolvedValueOnce(err({ type: 'database-error' }));

        await expect(loadDashboardModerationCases(request, 'guild-1')).resolves.toStrictEqual({
            type: 'database-error',
        });
    });

    it('loads default moderation policy when no policy is stored', async () => {
        await expect(loadDashboardModerationPolicy(request, 'guild-1')).resolves.toStrictEqual({
            type: 'policy',
            policy: {
                protectedUserIds: [],
                protectedRoleIds: [],
            },
            structureReadStatus: 'available',
            roles: [{ id: 'role-1', name: 'Moderator', position: 10, color: 0x38bdf8 }],
        });
    });

    it('loads stored moderation policy through the authorized guild scope', async () => {
        vi.mocked(findGuildModerationPolicyByGuildId).mockResolvedValueOnce(
            ok(createPolicy({ protectedUserIds: ['user-1'], protectedRoleIds: ['role-1'] }))
        );

        await expect(loadDashboardModerationPolicy(request, 'requested-guild')).resolves.toStrictEqual({
            type: 'policy',
            policy: {
                protectedUserIds: ['user-1'],
                protectedRoleIds: ['role-1'],
                updatedAt: '2026-06-26T10:01:00.000Z',
            },
            structureReadStatus: 'available',
            roles: [{ id: 'role-1', name: 'Moderator', position: 10, color: 0x38bdf8 }],
        });
        expect(findGuildModerationPolicyByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
            }
        );
    });

    it('updates moderation policy and records a dashboard audit event', async () => {
        vi.mocked(upsertGuildModerationPolicy).mockResolvedValueOnce(
            ok(createPolicy({ protectedUserIds: ['user-1'], protectedRoleIds: ['role-1'] }))
        );

        const result = await updateDashboardModerationPolicy(request, {
            guildId: 'requested-guild',
            protectedUserIds: [' user-1 ', 'user-1', ''],
            protectedRoleIds: [' role-1 '],
        });

        expect(result).toStrictEqual({
            type: 'updated',
            policy: {
                protectedUserIds: ['user-1'],
                protectedRoleIds: ['role-1'],
                updatedAt: '2026-06-26T10:01:00.000Z',
            },
        });
        expect(upsertGuildModerationPolicy).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                protectedUserIds: ['user-1'],
                protectedRoleIds: ['role-1'],
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'moderation',
                action: 'policy.updated',
                actorUserId: 'actor-1',
                targetId: 'authorized-guild',
                metadata: {
                    protectedUserCount: 1,
                    protectedRoleCount: 1,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('does not update policy when the guild is inaccessible', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(
            updateDashboardModerationPolicy(request, {
                guildId: 'guild-1',
                protectedUserIds: ['user-1'],
            })
        ).resolves.toStrictEqual({ type: 'not-found' });
        expect(upsertGuildModerationPolicy).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });
});

function createCase(overrides: Partial<ModerationCaseRecord> = {}): ModerationCaseRecord {
    return {
        id: 'case-1',
        guildId: 'guild-1',
        caseNumber: 1,
        action: 'warn',
        targetType: 'user',
        targetUserId: 'target-1',
        targetChannelId: null,
        actorUserId: 'mod-1',
        reason: 'Reason',
        status: 'open',
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
        updatedAt: new Date('2026-06-26T10:01:00.000Z'),
        ...overrides,
    };
}

function createPolicy(overrides: Partial<GuildModerationPolicyRecord> = {}): GuildModerationPolicyRecord {
    return {
        guildId: 'authorized-guild',
        protectedUserIds: [],
        protectedRoleIds: [],
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
        updatedAt: new Date('2026-06-26T10:01:00.000Z'),
        ...overrides,
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-1',
        guildId: 'authorized-guild',
        feature: 'moderation',
        action: 'policy.updated',
        actorUserId: 'actor-1',
        targetId: 'authorized-guild',
        metadata: {},
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
    };
}
