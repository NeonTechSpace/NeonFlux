import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    deleteVcGeneratorRule,
    findVcGeneratorControlPanelByRuleId,
    listVcGeneratorControlPanelsByGuildId,
    listVcGeneratorRulesByGuildId,
    recordBotActionEvent,
    upsertVcGeneratorControlPanel,
    upsertVcGeneratorRule,
} from '@neonflux/db';
import type { VcGeneratorControlPanelRecord, VcGeneratorRuleRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import {
    reactFluxerBotGuildChannelMessage,
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
    deleteDashboardVcGeneratorRule,
    loadDashboardVcGeneratorSettings,
    updateDashboardVcGeneratorRule,
} from './dashboard-vc-generator.server.js';
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
        deleteVcGeneratorRule: vi.fn(),
        findVcGeneratorControlPanelByRuleId: vi.fn(),
        listVcGeneratorControlPanelsByGuildId: vi.fn(),
        listVcGeneratorRulesByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        upsertVcGeneratorControlPanel: vi.fn(),
        upsertVcGeneratorRule: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

    return {
        ...actual,
        reactFluxerBotGuildChannelMessage: vi.fn(),
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

describe('dashboard VC generator settings', () => {
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
                    createFluxerChannel({
                        id: 'source-voice-1',
                        name: 'Join to Create',
                        type: 2,
                        parentId: 'category-1',
                        position: 1,
                    }),
                    createFluxerChannel({
                        id: 'panel-channel-1',
                        name: 'Voice Panels',
                        type: 0,
                        parentId: 'category-1',
                        position: 2,
                    }),
                ],
                categories: [
                    {
                        id: 'category-1',
                        name: 'Voice',
                        type: 4,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            })
        );
        vi.mocked(listVcGeneratorRulesByGuildId).mockResolvedValue(ok([createRule()]));
        vi.mocked(listVcGeneratorControlPanelsByGuildId).mockResolvedValue(ok([createPanel()]));
        vi.mocked(findVcGeneratorControlPanelByRuleId).mockResolvedValue(err({ type: 'not-found' }));
        vi.mocked(upsertVcGeneratorRule).mockResolvedValue(ok(createRule()));
        vi.mocked(upsertVcGeneratorControlPanel).mockResolvedValue(ok(createPanel()));
        vi.mocked(deleteVcGeneratorRule).mockResolvedValue(ok(createRule()));
        vi.mocked(sendFluxerBotGuildChannelMessage).mockResolvedValue(
            ok({
                id: 'panel-message-2',
                guildId: 'guild-1',
                channelId: 'panel-channel-1',
            })
        );
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValue(ok(undefined));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads configured rules with source, category, and panel labels', async () => {
        const result = await loadDashboardVcGeneratorSettings(request, 'guild-1');

        expect(result).toStrictEqual({
            type: 'settings',
            structureReadStatus: 'available',
            voiceChannels: [
                {
                    id: 'source-voice-1',
                    name: 'Join to Create',
                    type: 2,
                    parentId: 'category-1',
                    parentName: 'Voice',
                    position: 1,
                },
            ],
            textChannels: [
                {
                    id: 'panel-channel-1',
                    name: 'Voice Panels',
                    type: 0,
                    parentId: 'category-1',
                    parentName: 'Voice',
                    position: 2,
                },
            ],
            categories: [{ id: 'category-1', name: 'Voice', position: 1 }],
            rules: [
                {
                    id: 'vc-rule-1',
                    sourceChannelId: 'source-voice-1',
                    sourceChannelName: 'Join to Create',
                    categoryId: 'category-1',
                    categoryName: 'Voice',
                    panelChannelId: 'panel-channel-1',
                    panelChannelName: 'Voice Panels',
                    panelMessageId: 'panel-message-1',
                    panelStatus: 'active',
                    nameTemplate: '{user} room',
                    enabled: true,
                    updatedAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        expect(listVcGeneratorRulesByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
        expect(readFluxerBotGuildStructure).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
        });
    });

    it('loads saved rules when the web service has no bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await loadDashboardVcGeneratorSettings(request, 'guild-1');

        expect(result).toMatchObject({
            type: 'settings',
            structureReadStatus: 'bot-token-missing',
            voiceChannels: [],
            textChannels: [],
            categories: [],
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('denies unavailable or unauthorized guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await updateDashboardVcGeneratorRule(request, createUpdateInput());

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(upsertVcGeneratorRule).not.toHaveBeenCalled();
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates a rule, publishes a panel, and records dashboard audit metadata', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
        });
        vi.mocked(upsertVcGeneratorRule).mockResolvedValueOnce(ok(createRule({ guildId: 'authorized-guild' })));

        const result = await updateDashboardVcGeneratorRule(request, createUpdateInput({ guildId: 'requested-guild' }));

        expect(result).toMatchObject({
            type: 'updated',
            rule: {
                panelChannelId: 'panel-channel-1',
                panelMessageId: 'panel-message-1',
            },
        });
        expect(upsertVcGeneratorRule).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                sourceChannelId: 'source-voice-1',
                nameTemplate: '{user} room',
                categoryId: 'category-1',
                enabled: true,
            }
        );
        expect(sendFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
            channelId: 'panel-channel-1',
            embeds: [expect.objectContaining({ title: 'Voice channel controls' })],
        });
        expect(reactFluxerBotGuildChannelMessage).toHaveBeenCalledTimes(6);
        expect(reactFluxerBotGuildChannelMessage).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
            channelId: 'panel-channel-1',
            messageId: 'panel-message-2',
            emoji: '✏️',
        });
        expect(upsertVcGeneratorControlPanel).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                ruleId: 'vc-rule-1',
                channelId: 'panel-channel-1',
                messageId: 'panel-message-2',
                controlMode: 'reaction',
                status: 'active',
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                feature: 'vc_generator',
                action: 'rule.updated',
                actorUserId: 'actor-1',
                targetId: 'source-voice-1',
                metadata: {
                    sourceChannelId: 'source-voice-1',
                    sourceChannelName: 'Join to Create',
                    categoryId: 'category-1',
                    categoryName: 'Voice',
                    panelChannelId: 'panel-channel-1',
                    panelMessageId: 'panel-message-1',
                    nameTemplate: '{user} room',
                    enabled: true,
                    source: 'dashboard',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                },
            }
        );
    });

    it('fails before writing when panel publishing is requested without a bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: undefined }));

        const result = await updateDashboardVcGeneratorRule(request, createUpdateInput());

        expect(result).toStrictEqual({ type: 'bot-token-missing' });
        expect(upsertVcGeneratorRule).not.toHaveBeenCalled();
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('reuses an existing panel in the same channel instead of sending duplicates', async () => {
        vi.mocked(findVcGeneratorControlPanelByRuleId).mockResolvedValueOnce(ok(createPanel()));

        const result = await updateDashboardVcGeneratorRule(request, createUpdateInput());

        expect(result).toMatchObject({
            type: 'updated',
            rule: {
                panelMessageId: 'panel-message-1',
            },
        });
        expect(sendFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
        expect(reactFluxerBotGuildChannelMessage).not.toHaveBeenCalled();
        expect(upsertVcGeneratorControlPanel).not.toHaveBeenCalled();
    });

    it('records newly sent panels as stale when reaction setup fails', async () => {
        vi.mocked(reactFluxerBotGuildChannelMessage).mockResolvedValueOnce(
            err({ type: 'react-failed', error: new Error('no access') })
        );

        const result = await updateDashboardVcGeneratorRule(request, createUpdateInput());

        expect(result).toMatchObject({
            type: 'updated',
        });
        expect(upsertVcGeneratorControlPanel).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                status: 'stale',
                synced: false,
            })
        );
    });

    it('deletes rules and records dashboard audit events', async () => {
        const result = await deleteDashboardVcGeneratorRule(request, {
            guildId: 'guild-1',
            sourceChannelId: 'source-voice-1',
        });

        expect(result).toMatchObject({
            type: 'deleted',
            rule: {
                sourceChannelId: 'source-voice-1',
            },
        });
        expect(deleteVcGeneratorRule).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                sourceChannelId: 'source-voice-1',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'vc_generator',
                action: 'rule.deleted',
                targetId: 'source-voice-1',
            })
        );
    });

    it('maps repository validation failures to invalid-input', async () => {
        vi.mocked(upsertVcGeneratorRule).mockResolvedValueOnce(
            err({ type: 'missing-input', field: 'sourceChannelId' })
        );

        const result = await updateDashboardVcGeneratorRule(request, createUpdateInput({ sourceChannelId: '' }));

        expect(result).toStrictEqual({ type: 'invalid-input', field: 'sourceChannelId' });
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });
});

function createUpdateInput(overrides: Partial<Parameters<typeof updateDashboardVcGeneratorRule>[1]> = {}) {
    return {
        guildId: 'guild-1',
        sourceChannelId: 'source-voice-1',
        nameTemplate: '{user} room',
        categoryId: 'category-1',
        panelChannelId: 'panel-channel-1',
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

function createRule(overrides: Partial<VcGeneratorRuleRecord> = {}): VcGeneratorRuleRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'vc-rule-1',
        guildId: 'guild-1',
        sourceChannelId: 'source-voice-1',
        nameTemplate: '{user} room',
        categoryId: 'category-1',
        enabled: true,
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createPanel(overrides: Partial<VcGeneratorControlPanelRecord> = {}): VcGeneratorControlPanelRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'vc-panel-1',
        guildId: 'guild-1',
        ruleId: 'vc-rule-1',
        channelId: 'panel-channel-1',
        messageId: 'panel-message-1',
        controlMode: 'reaction',
        status: 'active',
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSyncedAt: timestamp,
        staleAt: null,
        ...overrides,
    };
}

function createFluxerChannel(overrides: {
    id: string;
    name: string;
    type: number;
    parentId?: string;
    position: number;
}) {
    return {
        permissionOverwrites: [],
        parentId: null,
        ...overrides,
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'vc_generator',
        action: 'rule.updated',
        actorUserId: 'actor-1',
        targetId: 'source-voice-1',
        metadata: {
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}
