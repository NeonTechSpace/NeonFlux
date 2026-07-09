import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import {
    createStructureBackup,
    createStructureImportRun,
    findLatestStructureDriftBaselineBackupByGuildId,
    findStructureBackupByGuildId,
    findStructureBackupSettingsByGuildId,
    findStructureImportRunWithActionsByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureBackupSummaryPageByGuildId,
    listStructureImportRunsByGuildId,
    recordStructureImportActionsBatch,
    updateStructureImportRunStatus,
} from '@neonflux/db';
import type {
    StructureBackupSettingsRecord,
    StructureImportActionRecord,
    StructureImportRunWithActionsRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    confirmDashboardStructureImportRun,
    createDashboardStructureImportDryRun,
    downloadDashboardStructureExport,
    exportDashboardStructure,
    importDashboardStructureBackup,
    loadDashboardStructureSettings,
    readDashboardStructureBackupJson,
    readDashboardStructureDrift,
    retryDashboardStructureImportRun,
    toDashboardImportRun,
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

vi.mock('./db.server.js', () => ({
    getWebDb: () => ({
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
        createStructureBackup: vi.fn(),
        createStructureImportRun: vi.fn(),
        findLatestStructureDriftBaselineBackupByGuildId: vi.fn(),
        findStructureBackupByGuildId: vi.fn(),
        findStructureBackupSettingsByGuildId: vi.fn(),
        findStructureImportRunWithActionsByGuildId: vi.fn(),
        findStructureObservedEventStateByGuildId: vi.fn(),
        listStructureBackupSummaryPageByGuildId: vi.fn(),
        listStructureImportRunsByGuildId: vi.fn(),
        recordStructureImportActionsBatch: vi.fn(),
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
        vi.mocked(listStructureBackupSummaryPageByGuildId).mockResolvedValue(
            ok({ backups: [createExportRecord()], nextCursor: null })
        );
        vi.mocked(findStructureBackupSettingsByGuildId).mockResolvedValue(ok(createBackupSettingsRecord()));
        vi.mocked(listStructureImportRunsByGuildId).mockResolvedValue(ok([createImportRunRecord()]));
        vi.mocked(findStructureObservedEventStateByGuildId).mockResolvedValue(
            ok({
                guildId: 'authorized-guild',
                observedChangeCount: 2,
                targetChangeCounts: { channel: 2 },
                lastEventType: 'channel.updated',
                lastTargetType: 'channel',
                lastTargetId: 'channel-1',
                lastObservedAt: new Date('2026-06-26T10:30:00.000Z'),
                createdAt: new Date('2026-06-26T10:00:00.000Z'),
                updatedAt: new Date('2026-06-26T10:30:00.000Z'),
            })
        );
        vi.mocked(createStructureBackup).mockResolvedValue(ok(createExportRecord()));
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId).mockResolvedValue(ok(createExportRecord()));
        vi.mocked(findStructureBackupByGuildId).mockResolvedValue(ok(createExportRecord()));
        vi.mocked(createStructureImportRun).mockResolvedValue(ok(createImportRunRecord({ status: 'draft' })));
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createImportRunRecord()));
        vi.mocked(recordStructureImportActionsBatch).mockResolvedValue(ok([createImportActionRecord()]));
        vi.mocked(updateStructureImportRunStatus).mockResolvedValue(
            ok(createImportRunRecord({ status: 'dry_run_complete' }))
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads persisted server blueprint history through the authorized guild scope', async () => {
        const result = await loadDashboardStructureSettings(request, 'requested-guild');

        expect(result).toStrictEqual({
            type: 'settings',
            backups: [
                {
                    id: 'export-1',
                    name: 'Authorized Guild - 2026-06-26 - 10-00',
                    source: 'manual',
                    status: 'succeeded',
                    createdByUserId: 'actor-1',
                    createdAt: '2026-06-26T10:00:00.000Z',
                    completedAt: '2026-06-26T10:00:00.000Z',
                    roleCount: 1,
                    categoryCount: 1,
                    channelCount: 1,
                },
            ],
            backupSettings: {
                enabled: false,
                cadenceWeeks: 1,
                retentionDays: 180,
                lastAttemptAt: '2026-06-26T10:00:00.000Z',
                lastSuccessAt: '2026-06-26T10:00:00.000Z',
            },
            importRuns: [
                expect.objectContaining({
                    id: 'run-1',
                    status: 'dry_run_complete',
                    actionCount: 1,
                }),
            ],
            observedState: {
                observedChangeCount: 2,
                targetChangeCounts: { channel: 2 },
                changedSinceLastBackup: true,
                lastEventType: 'channel.updated',
                lastTargetType: 'channel',
                lastTargetId: 'channel-1',
                lastObservedAt: '2026-06-26T10:30:00.000Z',
            },
        });
        expect(listStructureBackupSummaryPageByGuildId).toHaveBeenCalledWith(
            {},
            { guildId: 'authorized-guild', limit: 50 }
        );
        expect(listStructureImportRunsByGuildId).toHaveBeenCalledWith({}, { guildId: 'authorized-guild', limit: 20 });
        expect(findStructureObservedEventStateByGuildId).toHaveBeenCalledWith({}, { guildId: 'authorized-guild' });
    });

    it('exposes compact scheduled drift status from backup settings', async () => {
        vi.mocked(findStructureBackupSettingsByGuildId).mockResolvedValueOnce(
            ok(
                createBackupSettingsRecord({
                    enabled: true,
                    lastDriftBaselineBackupId: 'backup-1',
                    lastDriftBaselineName: 'Baseline backup',
                    lastDriftChangeCount: 2,
                    lastDriftCheckedAt: new Date('2026-06-26T11:00:00.000Z'),
                    lastDriftFieldSummary: {
                        names: 1,
                        permissions: 0,
                        positions: 0,
                        parentMoves: 0,
                        typeChanges: 0,
                        roleVisuals: 0,
                    },
                    lastDriftHasMorePreview: true,
                    lastDriftLiveCounts: { roles: 1, categories: 1, channels: 1 },
                    lastDriftStatus: 'changed',
                    lastDriftSummary: { creates: 1, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 1 },
                    nextDriftCheckAt: new Date('2026-06-27T11:00:00.000Z'),
                })
            )
        );

        const result = await loadDashboardStructureSettings(request, 'requested-guild');

        expect(result).toMatchObject({
            type: 'settings',
            backupSettings: {
                enabled: true,
                nextDriftCheckAt: '2026-06-27T11:00:00.000Z',
                scheduledDrift: {
                    baselineBackupId: 'backup-1',
                    baselineName: 'Baseline backup',
                    changeCount: 2,
                    checkedAt: '2026-06-26T11:00:00.000Z',
                    hasMorePreview: true,
                    nextCheckAt: '2026-06-27T11:00:00.000Z',
                    status: 'changed',
                    summary: { creates: 1, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 1 },
                },
            },
        });
    });

    it('creates a manual backup from current Fluxer structure and records a dashboard audit event', async () => {
        const result = await exportDashboardStructure(request, 'requested-guild');

        expect(result).toMatchObject({
            type: 'backup-created',
            backup: {
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
        expect(createStructureBackup).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                createdByUserId: 'actor-1',
                source: 'manual',
                status: 'succeeded',
                structure: expect.objectContaining({
                    version: 1,
                    guildName: 'Authorized Guild',
                    roles: expect.any(Array),
                    categories: expect.any(Array),
                    channels: expect.any(Array),
                }),
                audit: expect.objectContaining({
                    action: 'structure.backup_created',
                    actorUserId: 'actor-1',
                    metadata: expect.objectContaining({
                        actorUsername: 'neonsy',
                        roleCount: 1,
                    }),
                }),
            })
        );
    });

    it('downloads current Fluxer server layout without creating a backup record', async () => {
        const result = await downloadDashboardStructureExport(request, 'requested-guild');

        expect(result).toMatchObject({
            type: 'structure-export-created',
            fileName: expect.stringMatching(/^Authorized-Guild-.+\.json$/u),
            structureJson: expect.any(String),
        });
        expect(readFluxerBotGuildStructure).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
        });
        expect(JSON.parse(result.type === 'structure-export-created' ? result.structureJson : '{}')).toMatchObject({
            version: 1,
            guildId: 'authorized-guild',
            guildName: 'Authorized Guild',
            roles: expect.any(Array),
            categories: expect.any(Array),
            channels: expect.any(Array),
        });
        expect(createStructureBackup).not.toHaveBeenCalled();
    });

    it('reads persisted backup JSON through the authorized guild scope', async () => {
        const result = await readDashboardStructureBackupJson(request, {
            backupId: 'backup-1',
            guildId: 'requested-guild',
        });

        expect(result).toMatchObject({
            type: 'backup-json',
            backupId: 'export-1',
            fileName: 'Authorized-Guild-2026-06-26-10-00.json',
            backupJson: expect.any(String),
        });
        expect(findStructureBackupByGuildId).toHaveBeenCalledWith(
            {},
            {
                backupId: 'backup-1',
                guildId: 'authorized-guild',
            }
        );
        const backupJson = JSON.parse(result.type === 'backup-json' ? result.backupJson : '{}');
        expect(backupJson).toMatchObject({
            version: 1,
            guildId: 'authorized-guild',
        });
        expect(backupJson).not.toHaveProperty('guildName');
    });

    it('checks drift against the latest successful regular baseline backup', async () => {
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId).mockResolvedValueOnce(
            ok(createDriftBaselineRecord())
        );

        const result = await readDashboardStructureDrift(request, {
            guildId: 'requested-guild',
        });

        expect(result).toMatchObject({
            type: 'structure-drift',
            baseline: {
                id: 'export-1',
                source: 'manual',
                status: 'succeeded',
            },
            summary: {
                creates: 0,
                updates: 3,
                deletes: 0,
                roles: 1,
                categories: 1,
                channels: 1,
            },
            fieldSummary: {
                names: 2,
                parentMoves: 1,
                permissions: 3,
                positions: 3,
                roleVisuals: 3,
                typeChanges: 1,
            },
            hasMorePreview: false,
        });
        expect(findLatestStructureDriftBaselineBackupByGuildId).toHaveBeenCalledWith(
            {},
            { guildId: 'authorized-guild' }
        );
        expect(readFluxerBotGuildStructure).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'authorized-guild',
        });
        expect(result.type === 'structure-drift' ? result.previewActions.map((action) => action.fields) : []).toEqual([
            ['name', 'position', 'color', 'permissions', 'hoist', 'mentionable'],
            ['position', 'permissionOverwrites'],
            ['name', 'type', 'parentId', 'position', 'permissionOverwrites'],
        ]);
    });

    it('checks drift against a selected restore-point baseline backup', async () => {
        vi.mocked(findStructureBackupByGuildId).mockResolvedValueOnce(
            ok({
                ...createDriftBaselineRecord(),
                id: 'restore-1',
                name: 'Authorized Guild - restore point - 2026-06-26 - 10-00',
                source: 'restore_point',
            })
        );

        const result = await readDashboardStructureDrift(request, {
            baselineBackupId: 'restore-1',
            guildId: 'requested-guild',
        });

        expect(result).toMatchObject({
            type: 'structure-drift',
            baseline: {
                id: 'restore-1',
                source: 'restore_point',
            },
        });
        expect(findStructureBackupByGuildId).toHaveBeenCalledWith(
            {},
            {
                backupId: 'restore-1',
                guildId: 'authorized-guild',
            }
        );
        expect(findLatestStructureDriftBaselineBackupByGuildId).not.toHaveBeenCalled();
    });

    it('returns no-baseline when no default drift baseline exists', async () => {
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId).mockResolvedValueOnce(err({ type: 'not-found' }));

        const result = await readDashboardStructureDrift(request, {
            guildId: 'requested-guild',
        });

        expect(result).toStrictEqual({ type: 'no-baseline' });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('does not read Fluxer when drift checking has no bot token', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(createWebConfig({ fluxerBotToken: '' }));

        const result = await readDashboardStructureDrift(request, {
            guildId: 'requested-guild',
        });

        expect(result).toStrictEqual({ type: 'bot-token-missing' });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('caps drift preview actions for large comparisons', async () => {
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId).mockResolvedValueOnce(
            ok(createLargeDriftBaselineRecord(105))
        );

        const result = await readDashboardStructureDrift(request, {
            guildId: 'requested-guild',
        });

        expect(result).toMatchObject({
            type: 'structure-drift',
            hasMorePreview: true,
            summary: {
                creates: 105,
            },
        });
        expect(result.type === 'structure-drift' ? result.previewActions : []).toHaveLength(100);
    });

    it('rejects selected drift baselines without usable JSON', async () => {
        vi.mocked(findStructureBackupByGuildId).mockResolvedValueOnce(
            ok({
                ...createExportRecord(),
                structure: null,
            })
        );

        const result = await readDashboardStructureDrift(request, {
            baselineBackupId: 'backup-1',
            guildId: 'requested-guild',
        });

        expect(result).toStrictEqual({ type: 'backup-json-unavailable' });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
    });

    it('imports a restore-point backup as a normal persisted dry-run', async () => {
        vi.mocked(findStructureBackupByGuildId).mockResolvedValueOnce(
            ok({
                ...createExportRecord(),
                id: 'backup-restore-1',
                name: 'Authorized Guild - restore point - 2026-06-26 - 10-00',
                source: 'restore_point',
            })
        );

        const result = await importDashboardStructureBackup(request, {
            backupId: 'backup-restore-1',
            guildId: 'requested-guild',
        });

        expect(result).toMatchObject({
            type: 'backup-import-created',
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
                sourceBackupId: 'backup-restore-1',
                plan: expect.objectContaining({
                    requestedSnapshot: expect.objectContaining({
                        channels: expect.any(Array),
                        version: 1,
                    }),
                    requestedSnapshotStoredAt: expect.any(String),
                    requestedSnapshotVersion: 1,
                    source: 'backup',
                }),
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                audit: expect.objectContaining({
                    action: 'structure.backup_import_created',
                    targetId: 'backup-restore-1',
                }),
                runId: 'run-1',
                status: 'dry_run_complete',
            })
        );
    });

    it('creates a persisted import dry-run without applying server layout changes', async () => {
        const backupJson = JSON.stringify({
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
            backupJson,
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
                    requestedSnapshot: expect.objectContaining({
                        channels: expect.arrayContaining([expect.objectContaining({ name: 'announcements' })]),
                        version: 1,
                    }),
                    requestedSnapshotStoredAt: expect.any(String),
                    requestedSnapshotVersion: 1,
                    summary: expect.objectContaining({
                        updates: 1,
                    }),
                    source: 'dashboard-json',
                }),
            })
        );
        expect(recordStructureImportActionsBatch).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                runId: 'run-1',
                actions: [
                    expect.objectContaining({
                        actionType: 'update',
                        targetType: 'channel',
                        targetId: 'channel-1',
                        status: 'dry_run',
                    }),
                ],
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenCalledWith(
            {},
            {
                audit: expect.objectContaining({
                    action: 'structure.import_dry_run_created',
                    actorUserId: 'actor-1',
                    targetId: 'run-1',
                    metadata: expect.objectContaining({
                        actionCount: 1,
                        updateCount: 1,
                    }),
                }),
                runId: 'run-1',
                status: 'dry_run_complete',
            }
        );
    });

    it('defaults JSON dry-runs to merge mode without deleting unmatched current roles', async () => {
        const current = createFluxerStructure();
        const backupJson = JSON.stringify({
            version: 1,
            roles: [],
            categories: current.categories,
            channels: current.channels,
        });

        const result = await createDashboardStructureImportDryRun(request, {
            guildId: 'requested-guild',
            backupJson,
        });

        expect(result).toMatchObject({ type: 'dry-run-created' });
        expect(createStructureImportRun).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                plan: expect.objectContaining({
                    importMode: 'merge',
                    summary: expect.objectContaining({
                        deletes: 0,
                    }),
                }),
            })
        );
        expect(recordStructureImportActionsBatch).not.toHaveBeenCalled();
    });

    it('creates replace-mode JSON dry-runs with reset deletes before same-name creates', async () => {
        const backupJson = JSON.stringify({
            version: 1,
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
            categories: [],
            channels: [],
        });

        const result = await createDashboardStructureImportDryRun(request, {
            guildId: 'requested-guild',
            backupJson,
            importMode: 'replace',
        });

        expect(result).toMatchObject({ type: 'dry-run-created' });
        expect(createStructureImportRun).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                plan: expect.objectContaining({
                    importMode: 'replace',
                    summary: expect.objectContaining({
                        creates: 1,
                        deletes: 3,
                    }),
                }),
            })
        );
        expect(recordStructureImportActionsBatch).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actions: [
                    expect.objectContaining({
                        actionType: 'delete',
                        targetType: 'channel',
                        targetId: 'channel-1',
                        sequence: 0,
                    }),
                    expect.objectContaining({
                        actionType: 'delete',
                        targetType: 'category',
                        targetId: 'category-1',
                        sequence: 1,
                    }),
                    expect.objectContaining({
                        actionType: 'delete',
                        targetType: 'role',
                        targetId: 'role-1',
                        sequence: 2,
                    }),
                    expect.objectContaining({
                        actionType: 'create',
                        targetType: 'role',
                        targetId: 'role-1',
                        sequence: 3,
                    }),
                ],
            })
        );
    });

    it('does not inline partial large import action lists into dashboard run responses', () => {
        const actions = Array.from({ length: 100 }, (_, index) =>
            createImportActionRecord({ id: `action-${String(index)}`, sequence: index })
        );
        const run = createImportRunRecord({
            actions,
            plan: {
                summary: {
                    creates: 0,
                    updates: 101,
                    deletes: 0,
                    roles: 0,
                    categories: 0,
                    channels: 101,
                },
            },
        });

        expect(toDashboardImportRun(run)).toMatchObject({
            actionCount: 101,
            actions: [],
        });
        expect(toDashboardImportRun(run)).not.toHaveProperty('requestedSnapshot');
    });

    it('cancels a dry-run when a later action batch write fails', async () => {
        vi.mocked(recordStructureImportActionsBatch)
            .mockResolvedValueOnce(ok([createImportActionRecord()]))
            .mockResolvedValueOnce(err({ type: 'database-error' }));

        const current = createFluxerStructure();
        const backupJson = JSON.stringify({
            version: 1,
            roles: current.roles,
            categories: current.categories,
            channels: [
                ...current.channels,
                ...Array.from({ length: 101 }, (_, index) => ({
                    ...current.channels[0],
                    id: `new-channel-${String(index)}`,
                    name: `new-channel-${String(index)}`,
                })),
            ],
        });

        const result = await createDashboardStructureImportDryRun(request, {
            guildId: 'requested-guild',
            backupJson,
        });

        expect(result).toStrictEqual({ type: 'database-error' });
        expect(recordStructureImportActionsBatch).toHaveBeenCalledTimes(2);
        expect(updateStructureImportRunStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                runId: 'run-1',
                status: 'cancelled',
                plan: expect.objectContaining({
                    errorType: 'action-write-failed',
                }),
            })
        );
    });

    it('rejects invalid import JSON before reading Fluxer structure', async () => {
        const result = await createDashboardStructureImportDryRun(request, {
            guildId: 'guild-1',
            backupJson: '{',
        });

        expect(result).toStrictEqual({
            type: 'invalid-input',
            message: 'Server blueprint JSON could not be parsed.',
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
        expect(findStructureImportRunWithActionsByGuildId).toHaveBeenCalledWith(
            {},
            {
                guildId: 'authorized-guild',
                runId: 'run-1',
            }
        );
        expect(updateStructureImportRunStatus).toHaveBeenCalledWith(
            {},
            {
                audit: expect.objectContaining({
                    action: 'structure.import_confirmed',
                    actorUserId: 'actor-1',
                    targetId: 'run-1',
                    metadata: expect.objectContaining({
                        actionCount: 1,
                    }),
                }),
                runId: 'run-1',
                status: 'confirmed',
            }
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
        expect(findStructureImportRunWithActionsByGuildId).not.toHaveBeenCalled();
        expect(updateStructureImportRunStatus).not.toHaveBeenCalled();
    });

    it('does not confirm runs that are not dry-run complete', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValueOnce(
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

    it('creates retry dry-runs from failed partial-create actions with the saved source map', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValueOnce(
            ok(
                createImportRunRecord({
                    id: 'failed-run-1',
                    status: 'failed',
                    plan: {
                        applySummary: {
                            sourceTargetMap: {
                                'source-channel-1': 'created-channel-1',
                            },
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
                        createImportActionRecord({
                            id: 'failed-action-1',
                            actionType: 'create',
                            targetType: 'channel',
                            targetId: 'source-channel-1',
                            status: 'failed',
                            details: {
                                label: 'announcements',
                                sourceId: 'source-channel-1',
                                createdId: 'created-channel-1',
                                errorType: 'partial-create-failed',
                                after: {
                                    id: 'source-channel-1',
                                    name: 'announcements',
                                    type: 0,
                                    parentId: null,
                                    position: 1,
                                    permissionOverwrites: [],
                                },
                            },
                        }),
                    ],
                })
            )
        );
        vi.mocked(createStructureImportRun).mockResolvedValueOnce(
            ok(createImportRunRecord({ id: 'retry-run-1', status: 'draft', actions: [] }))
        );
        vi.mocked(recordStructureImportActionsBatch).mockResolvedValueOnce(
            ok([
                createImportActionRecord({
                    id: 'retry-action-1',
                    runId: 'retry-run-1',
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    status: 'dry_run',
                    details: {
                        retryOfActionId: 'failed-action-1',
                    },
                }),
            ])
        );
        vi.mocked(updateStructureImportRunStatus).mockResolvedValueOnce(
            ok(createImportRunRecord({ id: 'retry-run-1', status: 'dry_run_complete' }))
        );

        const result = await retryDashboardStructureImportRun(request, {
            guildId: 'requested-guild',
            importRunId: 'failed-run-1',
        });

        expect(result).toMatchObject({
            type: 'retry-created',
            importRun: {
                id: 'retry-run-1',
                status: 'dry_run_complete',
            },
        });
        expect(createStructureImportRun).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                plan: expect.objectContaining({
                    retryOfRunId: 'failed-run-1',
                    sourceTargetMap: {
                        'source-channel-1': 'created-channel-1',
                    },
                    summary: expect.objectContaining({
                        creates: 1,
                        channels: 1,
                    }),
                }),
            })
        );
        expect(vi.mocked(createStructureImportRun).mock.calls[0]?.[1].plan).not.toHaveProperty('requestedSnapshot');
        expect(recordStructureImportActionsBatch).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                runId: 'retry-run-1',
                actions: [
                    expect.objectContaining({
                        actionType: 'create',
                        targetId: 'source-channel-1',
                        details: expect.objectContaining({
                            retryOfActionId: 'failed-action-1',
                            createdId: 'created-channel-1',
                        }),
                    }),
                ],
            })
        );
    });

    it('does not export when the web service has no bot token', async () => {
        const config = createWebConfig();

        delete config.fluxerBotToken;
        vi.mocked(loadWebConfig).mockReturnValueOnce(config);

        const result = await exportDashboardStructure(request, 'guild-1');

        expect(result).toStrictEqual({ type: 'bot-token-missing' });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(createStructureBackup).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                createdByUserId: 'actor-1',
                source: 'manual',
                status: 'failed',
                errorMessage: 'The web service needs FLUXER_BOT_TOKEN to read server layout.',
                audit: expect.objectContaining({
                    action: 'structure.backup_failed',
                    actorUserId: 'actor-1',
                    metadata: expect.objectContaining({
                        errorMessage: 'The web service needs FLUXER_BOT_TOKEN to read server layout.',
                        source: 'manual',
                    }),
                }),
            })
        );
    });

    it('persists and audits failed manual backup reads', async () => {
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValueOnce(
            err({ type: 'login-failed', error: new Error('rate limited') })
        );

        const result = await exportDashboardStructure(request, 'guild-1');

        expect(result).toStrictEqual({ type: 'structure-read-failed' });
        expect(createStructureBackup).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'authorized-guild',
                createdByUserId: 'actor-1',
                source: 'manual',
                status: 'failed',
                errorMessage: 'Could not read server layout: login-failed.',
                roleCount: 0,
                categoryCount: 0,
                channelCount: 0,
                audit: expect.objectContaining({
                    action: 'structure.backup_failed',
                    actorUserId: 'actor-1',
                    metadata: expect.objectContaining({
                        errorMessage: 'Could not read server layout: login-failed.',
                        source: 'manual',
                    }),
                }),
            })
        );
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

function createFluxerStructure() {
    return {
        guildId: 'authorized-guild',
        guildName: 'Authorized Guild',
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
        name: 'Authorized Guild - 2026-06-26 - 10-00',
        createdByUserId: 'actor-1',
        source: 'manual',
        status: 'succeeded',
        errorMessage: null,
        structure: {
            version: 1,
            guildId: 'authorized-guild',
            roles: createFluxerStructure().roles,
            categories: createFluxerStructure().categories,
            channels: createFluxerStructure().channels,
        },
        roleCount: 1,
        categoryCount: 1,
        channelCount: 1,
        createdAt: new Date('2026-06-26T10:00:00.000Z'),
        completedAt: new Date('2026-06-26T10:00:00.000Z'),
    };
}

function createDriftBaselineRecord() {
    const structure = createFluxerStructure();

    return {
        ...createExportRecord(),
        structure: {
            version: 1,
            guildId: 'authorized-guild',
            roles: [
                {
                    ...structure.roles[0],
                    name: 'Members',
                    position: 2,
                    color: 123,
                    permissions: '8',
                    hoist: true,
                    mentionable: true,
                },
            ],
            categories: [
                {
                    ...structure.categories[0],
                    position: 2,
                    permissionOverwrites: [{ id: 'role-1', type: 0, allow: '1', deny: '0' }],
                },
            ],
            channels: [
                {
                    ...structure.channels[0],
                    name: 'chat',
                    type: 2,
                    parentId: null,
                    position: 2,
                    permissionOverwrites: [{ id: 'role-1', type: 0, allow: '1', deny: '0' }],
                },
            ],
        },
    };
}

function createLargeDriftBaselineRecord(createCount: number) {
    const structure = createFluxerStructure();

    return {
        ...createExportRecord(),
        structure: {
            version: 1,
            guildId: 'authorized-guild',
            roles: structure.roles,
            categories: structure.categories,
            channels: [
                ...structure.channels,
                ...Array.from({ length: createCount }, (_, index) => ({
                    id: `new-channel-${index}`,
                    name: `new-channel-${index}`,
                    type: 0,
                    parentId: null,
                    position: index + 2,
                    permissionOverwrites: [],
                })),
            ],
        },
    };
}

function createBackupSettingsRecord(overrides: Partial<StructureBackupSettingsRecord> = {}) {
    return {
        ...createBackupSettingsRecordBase(),
        ...overrides,
    };
}

function createBackupSettingsRecordBase() {
    return {
        guildId: 'authorized-guild',
        enabled: false,
        cadenceWeeks: 1,
        lastAttemptAt: new Date('2026-06-26T10:00:00.000Z'),
        lastSuccessAt: new Date('2026-06-26T10:00:00.000Z'),
        lastErrorMessage: null,
        nextBackupAt: null,
        nextDriftCheckAt: null,
        nextRetentionPruneAt: null,
        lastDriftCheckedAt: null,
        lastDriftStatus: null,
        lastDriftErrorMessage: null,
        lastDriftChangeCount: null,
        lastDriftBaselineBackupId: null,
        lastDriftBaselineName: null,
        lastDriftSummary: null,
        lastDriftFieldSummary: null,
        lastDriftLiveCounts: null,
        lastDriftHasMorePreview: false,
        retentionDays: 180,
    };
}

function createImportRunRecord(
    overrides: Partial<StructureImportRunWithActionsRecord> = {}
): StructureImportRunWithActionsRecord {
    return {
        ...createImportRunRecordBase(),
        ...overrides,
    };
}

function createImportRunRecordBase(): StructureImportRunWithActionsRecord {
    return {
        id: 'run-1',
        guildId: 'authorized-guild',
        createdByUserId: 'actor-1',
        status: 'dry_run_complete',
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
        confirmedAt: null,
        appliedAt: null,
        actions: [createImportActionRecord()],
    };
}

function createImportActionRecord(overrides: Partial<StructureImportActionRecord> = {}): StructureImportActionRecord {
    return {
        ...createImportActionRecordBase(),
        ...overrides,
    };
}

function createImportActionRecordBase(): StructureImportActionRecord {
    return {
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
    };
}
