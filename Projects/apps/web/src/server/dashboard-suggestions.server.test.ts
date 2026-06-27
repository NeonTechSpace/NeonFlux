import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    deleteSuggestionBoard,
    listSuggestionBoardsByGuildId,
    recordBotActionEvent,
    upsertSuggestionBoard,
} from '@neonflux/db';
import type { SuggestionBoardRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    deleteDashboardSuggestionBoard,
    loadDashboardSuggestionsSettings,
    updateDashboardSuggestionBoard,
} from './dashboard-suggestions.server.js';
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

vi.mock('@neonflux/config', () => ({
    loadWebConfig: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        deleteSuggestionBoard: vi.fn(),
        listSuggestionBoardsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertSuggestionBoard: vi.fn(),
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

describe('dashboard suggestion board settings', () => {
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
                roles: [],
                channels: [
                    {
                        id: 'channel-1',
                        name: 'ideas',
                        type: 0,
                        parentId: 'category-1',
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
                categories: [
                    {
                        id: 'category-1',
                        name: 'Community',
                        type: 4,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            })
        );
        vi.mocked(listSuggestionBoardsByGuildId).mockResolvedValue(ok([createBoard()]));
        vi.mocked(upsertSuggestionBoard).mockResolvedValue(ok(createBoard()));
        vi.mocked(deleteSuggestionBoard).mockResolvedValue(ok(createBoard()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads configured boards with channel labels', async () => {
        const result = await loadDashboardSuggestionsSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            structureReadStatus: 'available',
            channels: [
                {
                    id: 'channel-1',
                    name: 'ideas',
                    type: 0,
                    parentId: 'category-1',
                    parentName: 'Community',
                    position: 1,
                },
            ],
            boards: [
                {
                    id: 'suggestion-board-1',
                    name: 'ideas',
                    channelId: 'channel-1',
                    channelName: 'ideas',
                    enabled: true,
                    updatedAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        expect(listSuggestionBoardsByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
    });

    it('loads saved boards when the web service has no bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await loadDashboardSuggestionsSettings(request, 'guild-1');

        expect(result).toMatchObject({
            type: 'settings',
            structureReadStatus: 'bot-token-missing',
            channels: [],
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('denies unavailable or unauthorized guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await updateDashboardSuggestionBoard(request, createUpdateInput());

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(upsertSuggestionBoard).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates boards through the authorized guild scope and records audit', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });
        vi.mocked(upsertSuggestionBoard).mockResolvedValueOnce(ok(createBoard({ guildId: 'authorized-guild' })));

        const result = await updateDashboardSuggestionBoard(request, createUpdateInput({ guildId: 'requested-guild' }));

        expect(result).toMatchObject({
            type: 'updated',
            board: {
                name: 'ideas',
            },
        });
        expect(upsertSuggestionBoard).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                name: 'ideas',
                channelId: 'channel-1',
                enabled: true,
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'suggestions',
                action: 'board.updated',
                actorUserId: 'actor-1',
                targetId: 'ideas',
                metadata: {
                    boardName: 'ideas',
                    channelId: 'channel-1',
                    channelName: 'ideas',
                    enabled: true,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('deletes boards and records dashboard audit events', async () => {
        const result = await deleteDashboardSuggestionBoard(request, {
            guildId: 'guild-1',
            name: 'ideas',
        });

        expect(result).toMatchObject({
            type: 'deleted',
            board: {
                name: 'ideas',
            },
        });
        expect(deleteSuggestionBoard).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                name: 'ideas',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'suggestions',
                action: 'board.deleted',
                targetId: 'ideas',
            })
        );
    });

    it('maps repository validation failures to invalid-input', async () => {
        vi.mocked(upsertSuggestionBoard).mockResolvedValueOnce(err({ type: 'missing-input', field: 'channelId' }));

        const result = await updateDashboardSuggestionBoard(request, createUpdateInput({ channelId: '' }));

        expect(result).toStrictEqual({ type: 'invalid-input', field: 'channelId' });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });
});

function createUpdateInput(overrides: Partial<Parameters<typeof updateDashboardSuggestionBoard>[1]> = {}) {
    return {
        guildId: 'guild-1',
        name: 'ideas',
        channelId: 'channel-1',
        enabled: true,
        ...overrides,
    };
}

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

function createBoard(overrides: Partial<SuggestionBoardRecord> = {}): SuggestionBoardRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'suggestion-board-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        name: 'ideas',
        enabled: true,
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'suggestions',
        action: 'board.updated',
        actorUserId: 'actor-1',
        targetId: 'ideas',
        metadata: {
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}
