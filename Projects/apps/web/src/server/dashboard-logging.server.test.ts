import {
    deleteGuildLoggingDestination,
    listGuildLoggingDestinationsByGuildId,
    recordBotActionEvent,
    upsertGuildLoggingDestination,
} from '@neonflux/db';
import type { GuildLoggingDestinationRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    deleteDashboardLoggingDestination,
    loadDashboardLoggingSettings,
    updateDashboardLoggingDestination,
} from './dashboard-logging.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/logging');
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

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        deleteGuildLoggingDestination: vi.fn(),
        listGuildLoggingDestinationsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertGuildLoggingDestination: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard logging settings', () => {
    beforeEach(() => {
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
        vi.mocked(listGuildLoggingDestinationsByGuildId).mockResolvedValue(ok([createDestination()]));
        vi.mocked(upsertGuildLoggingDestination).mockResolvedValue(ok(createDestination()));
        vi.mocked(deleteGuildLoggingDestination).mockResolvedValue(ok(createDestination()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads event groups and destinations through the authorized guild scope', async () => {
        const result = await loadDashboardLoggingSettings(request, 'requested-guild');

        expect(result.type).toBe('settings');

        if (result.type !== 'settings') {
            throw new Error(`Expected settings result, received ${result.type}`);
        }

        expect(result.eventGroups.map((group) => group.id)).toStrictEqual([
            'messages',
            'members',
            'moderation',
            'roles',
            'channels',
            'voice',
        ]);
        expect(result.destinations).toStrictEqual([
            {
                id: 'destination-1',
                eventGroup: 'messages',
                channelId: 'channel-1',
                enabled: true,
                updatedAt: '2026-06-26T10:01:00.000Z',
            },
        ]);
        expect(listGuildLoggingDestinationsByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
            }
        );
    });

    it('does not read or write when the guild is inaccessible', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        await expect(loadDashboardLoggingSettings(request, 'guild-1')).resolves.toStrictEqual({
            type: 'auth-required',
        });
        expect(listGuildLoggingDestinationsByGuildId).not.toHaveBeenCalled();

        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Guild One',
        });

        await expect(
            updateDashboardLoggingDestination(request, {
                guildId: 'guild-1',
                eventGroup: 'messages',
                channelId: 'channel-1',
            })
        ).resolves.toStrictEqual({ type: 'not-found' });
        expect(upsertGuildLoggingDestination).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates a logging destination and records a dashboard audit event', async () => {
        vi.mocked(upsertGuildLoggingDestination).mockResolvedValueOnce(
            ok(createDestination({ eventGroup: 'moderation', channelId: 'mod-log', enabled: false }))
        );

        const result = await updateDashboardLoggingDestination(request, {
            guildId: 'requested-guild',
            eventGroup: 'moderation',
            channelId: 'mod-log',
            enabled: false,
        });

        expect(result).toStrictEqual({
            type: 'updated',
            destination: {
                id: 'destination-1',
                eventGroup: 'moderation',
                channelId: 'mod-log',
                enabled: false,
                updatedAt: '2026-06-26T10:01:00.000Z',
            },
        });
        expect(upsertGuildLoggingDestination).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                eventGroup: 'moderation',
                channelId: 'mod-log',
                enabled: false,
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'logging',
                action: 'destination.updated',
                actorUserId: 'actor-1',
                targetId: 'moderation',
                metadata: {
                    eventGroup: 'moderation',
                    channelId: 'mod-log',
                    enabled: false,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('deletes a logging destination and records a dashboard audit event', async () => {
        const result = await deleteDashboardLoggingDestination(request, {
            guildId: 'requested-guild',
            eventGroup: 'messages',
        });

        expect(result).toStrictEqual({
            type: 'deleted',
            destination: {
                id: 'destination-1',
                eventGroup: 'messages',
                channelId: 'channel-1',
                enabled: true,
                updatedAt: '2026-06-26T10:01:00.000Z',
            },
        });
        expect(deleteGuildLoggingDestination).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                eventGroup: 'messages',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'logging',
                action: 'destination.deleted',
                actorUserId: 'actor-1',
                targetId: 'messages',
                metadata: {
                    eventGroup: 'messages',
                    channelId: 'channel-1',
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('maps repository validation failures to invalid-input', async () => {
        vi.mocked(upsertGuildLoggingDestination).mockResolvedValueOnce(
            err({ type: 'invalid-value', field: 'eventGroup' })
        );

        await expect(
            updateDashboardLoggingDestination(request, {
                guildId: 'requested-guild',
                eventGroup: 'unknown',
                channelId: 'channel-1',
            })
        ).resolves.toStrictEqual({
            type: 'invalid-input',
            field: 'eventGroup',
        });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });
});

function createDestination(overrides: Partial<GuildLoggingDestinationRecord> = {}): GuildLoggingDestinationRecord {
    return {
        id: 'destination-1',
        guildId: 'authorized-guild',
        eventGroup: 'messages',
        channelId: 'channel-1',
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
        feature: 'logging',
        action: 'destination.updated',
        actorUserId: 'actor-1',
        targetId: 'messages',
        metadata: {},
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
    };
}
