import { findXpSettingsByGuildId, recordBotActionEvent, upsertXpSettings } from '@neonflux/db';
import type { XpSettingsRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { loadDashboardXpSettings, updateDashboardXpSettings } from './dashboard-xp.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/community');
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
        findXpSettingsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertXpSettings: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard XP settings', () => {
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
        vi.mocked(findXpSettingsByGuildId).mockResolvedValue(ok(createXpSettingsRecord()));
        vi.mocked(upsertXpSettings).mockResolvedValue(ok(createXpSettingsRecord()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads saved XP settings through the authorized guild scope', async () => {
        const result = await loadDashboardXpSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            settings: {
                enabled: true,
                messageXpMin: 5,
                messageXpMax: 10,
                cooldownSeconds: 60,
                voiceXpPerMinute: 2,
                voiceMinimumMinutes: 5,
                updatedAt: '2026-06-26T00:00:00.000Z',
            },
        });
        expect(findXpSettingsByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('returns default disabled settings when the guild has no XP row yet', async () => {
        vi.mocked(findXpSettingsByGuildId).mockResolvedValueOnce(err({ type: 'not-found' }));

        const result = await loadDashboardXpSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            settings: {
                enabled: false,
                messageXpMin: 5,
                messageXpMax: 10,
                cooldownSeconds: 60,
                voiceXpPerMinute: 2,
                voiceMinimumMinutes: 5,
            },
        });
    });

    it('denies unavailable or unauthorized guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await updateDashboardXpSettings(request, createUpdateInput());

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(upsertXpSettings).not.toHaveBeenCalled();
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
        vi.mocked(upsertXpSettings).mockResolvedValueOnce(
            ok(
                createXpSettingsRecord({
                    guildId: 'authorized-guild',
                    enabled: false,
                    messageXpMin: 7,
                    messageXpMax: 12,
                    cooldownSeconds: 45,
                    voiceXpPerMinute: 3,
                    voiceMinimumMinutes: 4,
                })
            )
        );

        const result = await updateDashboardXpSettings(request, createUpdateInput({ guildId: 'requested-guild' }));

        expect(result).toMatchObject({
            type: 'updated',
            settings: {
                enabled: false,
                messageXpMin: 7,
                messageXpMax: 12,
                cooldownSeconds: 45,
                voiceXpPerMinute: 3,
                voiceMinimumMinutes: 4,
            },
        });
        expect(upsertXpSettings).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                enabled: true,
                messageXpMin: 7,
                messageXpMax: 12,
                cooldownSeconds: 45,
                voiceXpPerMinute: 3,
                voiceMinimumMinutes: 4,
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'xp',
                action: 'settings.updated',
                actorUserId: 'actor-1',
                targetId: 'authorized-guild',
                metadata: {
                    enabled: false,
                    messageXpMin: 7,
                    messageXpMax: 12,
                    cooldownSeconds: 45,
                    voiceXpPerMinute: 3,
                    voiceMinimumMinutes: 4,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('maps invalid input and repository validation failures to invalid-input', async () => {
        const invalidRuntimeInput = await updateDashboardXpSettings(request, {
            guildId: 'guild-1',
            enabled: true,
            messageXpMin: 5,
            messageXpMax: Number.NaN,
            cooldownSeconds: 60,
            voiceXpPerMinute: 2,
            voiceMinimumMinutes: 5,
        });

        expect(invalidRuntimeInput).toStrictEqual({ type: 'invalid-input', field: 'messageXpMax' });
        expect(upsertXpSettings).not.toHaveBeenCalled();

        vi.mocked(upsertXpSettings).mockResolvedValueOnce(err({ type: 'invalid-value', field: 'messageXpMin' }));

        const invalidRepositoryInput = await updateDashboardXpSettings(request, createUpdateInput());

        expect(invalidRepositoryInput).toStrictEqual({ type: 'invalid-input', field: 'messageXpMin' });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });
});

function createUpdateInput(overrides: Partial<Parameters<typeof updateDashboardXpSettings>[1]> = {}) {
    return {
        guildId: 'guild-1',
        enabled: true,
        messageXpMin: 7,
        messageXpMax: 12,
        cooldownSeconds: 45,
        voiceXpPerMinute: 3,
        voiceMinimumMinutes: 4,
        ...overrides,
    };
}

function createXpSettingsRecord(overrides: Partial<XpSettingsRecord> = {}): XpSettingsRecord {
    return {
        guildId: 'guild-1',
        enabled: true,
        messageXpMin: 5,
        messageXpMax: 10,
        cooldownSeconds: 60,
        voiceXpPerMinute: 2,
        voiceMinimumMinutes: 5,
        config: {},
        updatedAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'xp',
        action: 'settings.updated',
        actorUserId: 'actor-1',
        targetId: 'guild-1',
        metadata: {
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}
