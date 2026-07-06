import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import { findStructureImportRunWithActionsByGuildId } from '@neonflux/db';
import type { StructureImportRunWithActionsRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    loadAuthorizedStructureContext,
    recordStructureAuditBestEffort,
} from './dashboard-structure-context.server.js';
import type * as DashboardStructureContext from './dashboard-structure-context.server.js';
import { preflightDashboardStructureImportRun } from './dashboard-structure-preflight.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/structure');

vi.mock('./db.server.js', () => ({
    getWebDb: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-structure-context.server.js', async (importActual) => {
    const actual = await importActual<typeof DashboardStructureContext>();

    return {
        ...actual,
        loadAuthorizedStructureContext: vi.fn(),
        recordStructureAuditBestEffort: vi.fn(),
    };
});

vi.mock('@neonflux/config', () => ({
    loadWebConfig: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        findStructureImportRunWithActionsByGuildId: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

    return {
        ...actual,
        readFluxerBotGuildStructure: vi.fn(),
    };
});

describe('preflightDashboardStructureImportRun', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue(createWebConfig());
        vi.mocked(loadAuthorizedStructureContext).mockResolvedValue({
            type: 'authorized',
            guild: {
                id: 'authorized-guild',
                name: 'Authorized Guild',
            },
            actor: {
                actorUserId: 'actor-1',
                metadata: {
                    actorUsername: 'neonsy',
                },
            },
        });
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createImportRunRecord()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure()));
        vi.mocked(recordStructureAuditBestEffort).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('preflights a confirmed import run without applying server changes', async () => {
        const result = await preflightDashboardStructureImportRun(request, {
            guildId: 'requested-guild',
            importRunId: 'run-1',
        });

        expect(result).toMatchObject({
            type: 'preflight',
            importRunId: 'run-1',
            report: {
                summary: {
                    total: 1,
                    ready: 1,
                },
            },
        });
        expect(findStructureImportRunWithActionsByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                runId: 'run-1',
            }
        );
        expect(readFluxerBotGuildStructure).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
        });
        expect(recordStructureAuditBestEffort).toHaveBeenCalledWith(
            expect.objectContaining({
                guild: expect.objectContaining({ id: 'authorized-guild' }),
            }),
            'structure.import_preflight_checked',
            'run-1',
            expect.objectContaining({
                actionCount: 1,
                readyCount: 1,
                staleCount: 0,
            })
        );
    });

    it('uses saved source-to-target mappings when preflighting retry runs', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValueOnce(
            ok(
                createImportRunRecord({
                    plan: {
                        sourceTargetMap: {
                            'source-role-1': 'created-role-1',
                        },
                        summary: {
                            creates: 1,
                            updates: 0,
                            deletes: 0,
                            roles: 0,
                            categories: 0,
                            channels: 1,
                        },
                    },
                    actions: [
                        {
                            id: 'retry-channel',
                            runId: 'run-1',
                            sequence: 0,
                            actionType: 'create',
                            targetType: 'channel',
                            targetId: 'source-channel-1',
                            status: 'dry_run',
                            details: {
                                label: 'retry-channel',
                                after: {
                                    id: 'source-channel-1',
                                    name: 'retry-channel',
                                    type: 0,
                                    parentId: null,
                                    position: 3,
                                    permissionOverwrites: [
                                        {
                                            id: 'source-role-1',
                                            type: 0,
                                            allow: '1024',
                                            deny: '0',
                                        },
                                    ],
                                },
                            },
                            createdAt: new Date('2026-06-26T10:05:00.000Z'),
                            updatedAt: new Date('2026-06-26T10:05:00.000Z'),
                        },
                    ],
                })
            )
        );
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValueOnce(
            ok({
                ...createFluxerStructure(),
                roles: [
                    {
                        id: 'created-role-1',
                        name: 'Imported Role',
                        position: 2,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
            })
        );

        const result = await preflightDashboardStructureImportRun(request, {
            guildId: 'requested-guild',
            importRunId: 'run-1',
        });

        expect(result).toMatchObject({
            type: 'preflight',
            report: {
                summary: {
                    ready: 1,
                    mappingRequired: 0,
                },
            },
        });
    });

    it('requires a confirmed run before preflight', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValueOnce(
            ok(createImportRunRecord({ status: 'dry_run_complete' }))
        );

        const result = await preflightDashboardStructureImportRun(request, {
            guildId: 'requested-guild',
            importRunId: 'run-1',
        });

        expect(result).toStrictEqual({
            type: 'not-preflightable',
            status: 'dry_run_complete',
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(recordStructureAuditBestEffort).not.toHaveBeenCalled();
    });

    it('returns bot-token-missing before reading live structure', async () => {
        const config = createWebConfig();

        delete config.fluxerBotToken;
        vi.mocked(loadWebConfig).mockReturnValueOnce(config);

        const result = await preflightDashboardStructureImportRun(request, {
            guildId: 'requested-guild',
            importRunId: 'run-1',
        });

        expect(result).toStrictEqual({ type: 'bot-token-missing' });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });
});

function createWebConfig(overrides: Partial<WebConfig> = {}): WebConfig {
    return {
        appEnv: 'development',
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

function createImportRunRecord(overrides: Partial<StructureImportRunWithActionsRecord> = {}) {
    return {
        ...createImportRunRecordBase(),
        ...overrides,
    };
}

function createImportRunRecordBase() {
    return {
        id: 'run-1',
        guildId: 'authorized-guild',
        createdByUserId: 'actor-1',
        status: 'confirmed',
        sourceBackupId: null,
        plan: {
            summary: {
                creates: 0,
                updates: 1,
                deletes: 0,
                roles: 0,
                categories: 0,
                channels: 1,
            },
        },
        createdAt: new Date('2026-06-26T10:05:00.000Z'),
        updatedAt: new Date('2026-06-26T10:05:01.000Z'),
        confirmedAt: new Date('2026-06-26T10:06:00.000Z'),
        appliedAt: null,
        actions: [
            {
                id: 'action-1',
                runId: 'run-1',
                sequence: 0,
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                details: {
                    label: 'general',
                    changes: [{ field: 'name', before: 'general', after: 'announcements' }],
                },
                createdAt: new Date('2026-06-26T10:05:00.000Z'),
                updatedAt: new Date('2026-06-26T10:05:00.000Z'),
            },
        ],
    };
}

function createFluxerStructure() {
    return {
        guildId: 'authorized-guild',
        guildName: 'Authorized Guild',
        roles: [],
        categories: [],
        channels: [
            {
                id: 'channel-1',
                name: 'general',
                type: 0,
                parentId: null,
                position: 1,
                permissionOverwrites: [],
            },
        ],
    };
}
