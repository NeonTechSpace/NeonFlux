import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    createStructureExportSnapshot,
    createStructureImportRun,
    findStructureImportRunByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureExportSnapshotsByGuildId,
    listStructureImportRunsByGuildId,
    recordBotActionEvent,
    recordStructureImportAction,
    updateStructureImportRunStatus,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    confirmDashboardStructureImportRun,
    createDashboardStructureImportDryRun,
    exportDashboardStructure,
    loadDashboardStructureSettings,
} from './dashboard-structure.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/structure');
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
        createStructureExportSnapshot: vi.fn(),
        createStructureImportRun: vi.fn(),
        findStructureImportRunByGuildId: vi.fn(),
        findStructureObservedEventStateByGuildId: vi.fn(),
        listStructureExportSnapshotsByGuildId: vi.fn(),
        listStructureImportRunsByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        recordStructureImportAction: vi.fn(),
        updateStructureImportRunStatus: vi.fn(),
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

describe('dashboard structure import/export', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue(createWebConfig());
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
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure()));
        vi.mocked(listStructureExportSnapshotsByGuildId).mockResolvedValue(ok([createExportRecord()]));
        vi.mocked(listStructureImportRunsByGuildId).mockResolvedValue(ok([createImportRunRecord()]));
        vi.mocked(findStructureObservedEventStateByGuildId).mockResolvedValue(
            ok({
                guildId: 'authorized-guild',
                observedChangeCount: 2,
                lastEventType: 'channel.updated',
                lastTargetType: 'channel',
                lastTargetId: 'channel-1',
                lastObservedAt: new Date('2026-06-26T10:30:00.000Z'),
                createdAt: new Date('2026-06-26T10:00:00.000Z'),
                updatedAt: new Date('2026-06-26T10:30:00.000Z'),
            })
        );
        vi.mocked(createStructureExportSnapshot).mockResolvedValue(ok(createExportRecord()));
        vi.mocked(createStructureImportRun).mockResolvedValue(ok(createImportRunRecord({ status: 'draft' })));
        vi.mocked(findStructureImportRunByGuildId).mockResolvedValue(ok(createImportRunRecord()));
        vi.mocked(recordStructureImportAction).mockResolvedValue(ok(createImportActionRecord()));
        vi.mocked(updateStructureImportRunStatus).mockResolvedValue(
            ok(createImportRunRecord({ status: 'dry_run_complete' }))
        );
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads persisted structure history through the authorized guild scope', async () => {
        const result = await loadDashboardStructureSettings(request, 'requested-guild');

        expect(result).toStrictEqual({
            type: 'settings',
            exports: [
                {
                    id: 'export-1',
                    source: 'dashboard',
                    createdByUserId: 'actor-1',
                    createdAt: '2026-06-26T10:00:00.000Z',
                    roleCount: 1,
                    categoryCount: 1,
                    channelCount: 1,
                },
            ],
            importRuns: [
                expect.objectContaining({
                    id: 'run-1',
                    status: 'dry_run_complete',
                    actions: [expect.objectContaining({ actionType: 'update' })],
                }),
            ],
            observedState: {
                observedChangeCount: 2,
                lastEventType: 'channel.updated',
                lastTargetType: 'channel',
                lastTargetId: 'channel-1',
                lastObservedAt: '2026-06-26T10:30:00.000Z',
            },
        });
        expect(listStructureExportSnapshotsByGuildId).toHaveBeenCalledWith(
            {},
            { guildId: 'authorized-guild', limit: 20 }
        );
        expect(listStructureImportRunsByGuildId).toHaveBeenCalledWith({}, { guildId: 'authorized-guild', limit: 20 });
        expect(findStructureObservedEventStateByGuildId).toHaveBeenCalledWith({}, { guildId: 'authorized-guild' });
    });

    it('exports current Fluxer structure and records a dashboard audit event', async () => {
        const result = await exportDashboardStructure(request, 'requested-guild');

        expect(result).toMatchObject({
            type: 'exported',
            exportSnapshot: {
                id: 'export-1',
                roleCount: 1,
                categoryCount: 1,
                channelCount: 1,
            },
        });
        expect(readFluxerBotGuildStructure).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
        });
        expect(createStructureExportSnapshot).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                createdByUserId: 'actor-1',
                source: 'dashboard',
                snapshot: expect.objectContaining({
                    version: 1,
                    roles: expect.any(Array),
                    categories: expect.any(Array),
                    channels: expect.any(Array),
                }),
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                feature: 'import_export',
                action: 'structure.exported',
                actorUserId: 'actor-1',
                targetId: 'export-1',
                metadata: expect.objectContaining({
                    actorUsername: 'neonsy',
                    roleCount: 1,
                }),
            })
        );
    });

    it('creates a persisted import dry-run without applying structure changes', async () => {
        const snapshotJson = JSON.stringify({
            version: 1,
            roles: createFluxerStructure().roles,
            categories: createFluxerStructure().categories,
            channels: [
                {
                    ...createFluxerStructure().channels[0],
                    name: 'announcements',
                },
            ],
        });

        const result = await createDashboardStructureImportDryRun(request, {
            guildId: 'requested-guild',
            snapshotJson,
        });

        expect(result).toMatchObject({
            type: 'dry-run-created',
            importRun: {
                id: 'run-1',
                status: 'dry_run_complete',
            },
        });
        expect(createStructureImportRun).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                createdByUserId: 'actor-1',
                plan: expect.objectContaining({
                    summary: expect.objectContaining({
                        updates: 1,
                    }),
                    source: 'dashboard-json',
                }),
            })
        );
        expect(recordStructureImportAction).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                runId: 'run-1',
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenCalledWith({}, { runId: 'run-1', status: 'dry_run_complete' });
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'import_export',
                action: 'structure.import_dry_run_created',
                targetId: 'run-1',
            })
        );
    });

    it('rejects invalid import JSON before reading Fluxer structure', async () => {
        const result = await createDashboardStructureImportDryRun(request, {
            guildId: 'guild-1',
            snapshotJson: '{',
        });

        expect(result).toStrictEqual({
            type: 'invalid-input',
            message: 'Structure JSON could not be parsed.',
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(createStructureImportRun).not.toHaveBeenCalled();
    });

    it('confirms a dry-run with exact confirmation text and records audit', async () => {
        vi.mocked(updateStructureImportRunStatus).mockResolvedValueOnce(
            ok(createImportRunRecord({ status: 'confirmed' }))
        );

        const result = await confirmDashboardStructureImportRun(request, {
            guildId: 'requested-guild',
            importRunId: 'run-1',
            confirmationText: 'CONFIRM run-1',
        });

        expect(result).toMatchObject({
            type: 'confirmed',
            importRun: {
                id: 'run-1',
                status: 'confirmed',
            },
        });
        expect(findStructureImportRunByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                runId: 'run-1',
            }
        );
        expect(updateStructureImportRunStatus).toHaveBeenCalledWith(
            {},
            {
                runId: 'run-1',
                status: 'confirmed',
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                feature: 'import_export',
                action: 'structure.import_confirmed',
                targetId: 'run-1',
                metadata: expect.objectContaining({
                    actionCount: 1,
                }),
            })
        );
    });

    it('rejects confirmation text mismatches before reading import runs', async () => {
        const result = await confirmDashboardStructureImportRun(request, {
            guildId: 'requested-guild',
            importRunId: 'run-1',
            confirmationText: 'CONFIRM',
        });

        expect(result).toStrictEqual({
            type: 'confirmation-mismatch',
            expectedText: 'CONFIRM run-1',
        });
        expect(findStructureImportRunByGuildId).not.toHaveBeenCalled();
        expect(updateStructureImportRunStatus).not.toHaveBeenCalled();
    });

    it('does not confirm runs that are not dry-run complete', async () => {
        vi.mocked(findStructureImportRunByGuildId).mockResolvedValueOnce(
            ok(createImportRunRecord({ status: 'confirmed' }))
        );

        const result = await confirmDashboardStructureImportRun(request, {
            guildId: 'requested-guild',
            importRunId: 'run-1',
            confirmationText: 'CONFIRM run-1',
        });

        expect(result).toStrictEqual({
            type: 'not-confirmable',
            status: 'confirmed',
        });
        expect(updateStructureImportRunStatus).not.toHaveBeenCalled();
    });

    it('does not export when the web service has no bot token', async () => {
        const config = createWebConfig();

        delete config.fluxerBotToken;
        vi.mocked(loadWebConfig).mockReturnValueOnce(config);

        const result = await exportDashboardStructure(request, 'guild-1');

        expect(result).toStrictEqual({ type: 'bot-token-missing' });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(createStructureExportSnapshot).not.toHaveBeenCalled();
    });
});

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
        guildId: 'authorized-guild',
        roles: [
            {
                id: 'role-1',
                name: 'Member',
                position: 1,
                color: 0,
                permissions: '0',
                hoist: false,
                mentionable: false,
            },
        ],
        categories: [
            {
                id: 'category-1',
                name: 'Info',
                type: 4,
                parentId: null,
                position: 0,
                permissionOverwrites: [],
            },
        ],
        channels: [
            {
                id: 'channel-1',
                name: 'general',
                type: 0,
                parentId: 'category-1',
                position: 1,
                permissionOverwrites: [],
            },
        ],
    };
}

function createExportRecord() {
    return {
        id: 'export-1',
        guildId: 'authorized-guild',
        createdByUserId: 'actor-1',
        source: 'dashboard',
        snapshot: {
            version: 1,
            roles: createFluxerStructure().roles,
            categories: createFluxerStructure().categories,
            channels: createFluxerStructure().channels,
        },
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
    };
}

function createImportRunRecord(overrides: Partial<ReturnType<typeof createImportRunRecordBase>> = {}) {
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
        status: 'dry_run_complete',
        sourceSnapshotId: null,
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
        confirmedAt: null,
        appliedAt: null,
        actions: [createImportActionRecord()],
    };
}

function createImportActionRecord() {
    return {
        id: 'action-1',
        runId: 'run-1',
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
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-1',
        guildId: 'authorized-guild',
        feature: 'import_export',
        action: 'structure.exported',
        actorUserId: 'actor-1',
        targetId: 'export-1',
        metadata: {},
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
    };
}
