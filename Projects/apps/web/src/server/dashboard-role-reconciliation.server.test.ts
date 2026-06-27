import {
    findRoleReconciliationSettingsByGuildId,
    recordBotActionEvent,
    upsertRoleReconciliationSettings,
} from '@neonflux/db';
import type { RoleReconciliationSettingsRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    loadDashboardRoleReconciliationSettings,
    updateDashboardRoleReconciliationSettings,
} from './dashboard-role-reconciliation.server.js';
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

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        findRoleReconciliationSettingsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertRoleReconciliationSettings: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard role reconciliation settings', () => {
    beforeEach(() => {
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
        vi.mocked(findRoleReconciliationSettingsByGuildId).mockResolvedValue(
            ok(createRoleReconciliationSettingsRecord())
        );
        vi.mocked(upsertRoleReconciliationSettings).mockResolvedValue(ok(createRoleReconciliationSettingsRecord()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads role reconciliation settings through the authorized guild scope', async () => {
        const result = await loadDashboardRoleReconciliationSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            settings: {
                enabled: true,
                restoreAutoroleRoles: true,
                restoreVerificationRoles: true,
                restoreReactionRoles: true,
                cleanupDeletedRoleReferences: true,
                updatedAt: '2026-06-26T00:00:00.000Z',
            },
        });
        expect(findRoleReconciliationSettingsByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('denies unavailable or unauthorized guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await updateDashboardRoleReconciliationSettings(request, createUpdateInput());

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(upsertRoleReconciliationSettings).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates settings and records dashboard audit metadata', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });
        vi.mocked(upsertRoleReconciliationSettings).mockResolvedValueOnce(
            ok(
                createRoleReconciliationSettingsRecord({
                    guildId: 'authorized-guild',
                    enabled: false,
                    restoreAutoroleRoles: false,
                    restoreVerificationRoles: true,
                    restoreReactionRoles: false,
                    cleanupDeletedRoleReferences: true,
                })
            )
        );

        const result = await updateDashboardRoleReconciliationSettings(
            request,
            createUpdateInput({ guildId: 'requested-guild' })
        );

        expect(result).toMatchObject({
            type: 'updated',
            settings: {
                enabled: false,
                restoreAutoroleRoles: false,
                restoreVerificationRoles: true,
                restoreReactionRoles: false,
                cleanupDeletedRoleReferences: true,
            },
        });
        expect(upsertRoleReconciliationSettings).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                enabled: true,
                restoreAutoroleRoles: false,
                restoreVerificationRoles: true,
                restoreReactionRoles: false,
                cleanupDeletedRoleReferences: true,
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'role_reconciliation',
                action: 'settings.updated',
                actorUserId: 'actor-1',
                targetId: 'authorized-guild',
                metadata: {
                    enabled: false,
                    restoreAutoroleRoles: false,
                    restoreVerificationRoles: true,
                    restoreReactionRoles: false,
                    cleanupDeletedRoleReferences: true,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('maps invalid input and repository failures', async () => {
        const invalidInput = await updateDashboardRoleReconciliationSettings(request, {
            guildId: 'guild-1',
            enabled: true,
            restoreAutoroleRoles: true,
            restoreVerificationRoles: true,
            restoreReactionRoles: true,
        });

        expect(invalidInput).toStrictEqual({
            type: 'invalid-input',
            field: 'cleanupDeletedRoleReferences',
        });
        expect(upsertRoleReconciliationSettings).not.toHaveBeenCalled();

        vi.mocked(upsertRoleReconciliationSettings).mockResolvedValueOnce(
            err({ type: 'missing-input', field: 'guildId' })
        );

        const repositoryFailure = await updateDashboardRoleReconciliationSettings(request, createUpdateInput());

        expect(repositoryFailure).toStrictEqual({ type: 'invalid-input', field: 'guildId' });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });
});

function createUpdateInput(overrides: Partial<Parameters<typeof updateDashboardRoleReconciliationSettings>[1]> = {}) {
    return {
        guildId: 'guild-1',
        enabled: true,
        restoreAutoroleRoles: false,
        restoreVerificationRoles: true,
        restoreReactionRoles: false,
        cleanupDeletedRoleReferences: true,
        ...overrides,
    };
}

function createRoleReconciliationSettingsRecord(
    overrides: Partial<RoleReconciliationSettingsRecord> = {}
): RoleReconciliationSettingsRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        guildId: 'guild-1',
        enabled: true,
        restoreAutoroleRoles: true,
        restoreVerificationRoles: true,
        restoreReactionRoles: true,
        cleanupDeletedRoleReferences: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createAuditEventRecord() {
    return {
        id: 'event-1',
        guildId: 'guild-1',
        feature: 'role_reconciliation',
        action: 'settings.updated',
        actorUserId: 'actor-1',
        targetId: 'guild-1',
        metadata: {},
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}
