import { loadWebConfig } from '@neonflux/config';
import type * as NeonFluxConfig from '@neonflux/config';
import {
    createStructureBackup,
    findStructureImportRunWithActionsByGuildId,
    updateStructureImportActionStatus,
    updateStructureImportRunStatus,
} from '@neonflux/db';
import type {
    StructureBackupRecord,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { applyFluxerBotGuildStructureActions, readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    applyDashboardStructureImportRun,
    getStructureImportApplyText,
    getStructureImportDeleteApprovalText,
} from './dashboard-structure-apply.server.js';
import {
    loadAuthorizedStructureContext,
    recordStructureAuditBestEffort,
} from './dashboard-structure-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/structure');

vi.mock('@neonflux/config', async (importActual) => {
    const actual = await importActual<typeof NeonFluxConfig>();

    return {
        ...actual,
        loadWebConfig: vi.fn(),
    };
});

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        createStructureBackup: vi.fn(),
        findStructureImportRunWithActionsByGuildId: vi.fn(),
        updateStructureImportActionStatus: vi.fn(),
        updateStructureImportRunStatus: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

    return {
        ...actual,
        applyFluxerBotGuildStructureActions: vi.fn(),
        readFluxerBotGuildStructure: vi.fn(),
    };
});

vi.mock('./db.server.js', () => ({
    getWebDb: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-structure-context.server.js', () => ({
    loadAuthorizedStructureContext: vi.fn(),
    recordStructureAuditBestEffort: vi.fn(),
}));

describe('dashboard structure apply', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue({
            fluxerBotToken: 'bot-token',
        } as ReturnType<typeof loadWebConfig>);
        vi.mocked(loadAuthorizedStructureContext).mockResolvedValue({
            type: 'authorized',
            guild: {
                id: 'guild-1',
                name: 'Guild One',
            },
            actor: {
                actorUserId: 'actor-1',
                metadata: {
                    actorUsername: 'neonsy',
                },
            },
        });
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createImportRun()));
        vi.mocked(updateStructureImportRunStatus).mockImplementation(async (_db, input) =>
            ok(createImportRun({ status: input.status }))
        );
        vi.mocked(updateStructureImportActionStatus).mockImplementation(async (_db, input) =>
            ok({
                ...createActionRecord(),
                status: input.status,
                details: input.details ?? {},
            })
        );
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure()));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValue(
            ok({ actions: [{ id: 'action-1', status: 'applied' }], idMap: {} })
        );
        vi.mocked(createStructureBackup).mockResolvedValue(ok(createRestorePointBackupRecord()));
        vi.mocked(recordStructureAuditBestEffort).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('requires the explicit apply confirmation before reading or mutating structure', async () => {
        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: 'CONFIRM run-1',
        });

        expect(result).toStrictEqual({
            type: 'confirmation-mismatch',
            expectedText: 'APPLY run-1',
        });
        expect(findStructureImportRunWithActionsByGuildId).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('applies preflight-ready channel name updates and records action results', async () => {
        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(updateStructureImportRunStatus).toHaveBeenNthCalledWith(
            1,
            {},
            expect.objectContaining({
                plan: expect.objectContaining({
                    applyAttempt: expect.objectContaining({
                        outcome: 'active',
                        roleOrder: { status: 'not-required' },
                    }),
                }),
                runId: 'run-1',
                status: 'applying',
            })
        );
        expect(applyFluxerBotGuildStructureActions).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actions: [
                {
                    id: 'action-1',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    changes: [{ field: 'name', before: 'old-name', after: 'new-name' }],
                    after: undefined,
                },
            ],
            beforeMutation: expect.any(Function),
            stopAfterDeleteFailures: false,
        });
        expect(updateStructureImportActionStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionId: 'action-1',
                status: 'applied',
            })
        );
        expect(createStructureBackup).not.toHaveBeenCalled();
        expect(recordStructureAuditBestEffort).toHaveBeenCalledWith(
            expect.anything(),
            'structure.import_applied',
            'run-1',
            expect.objectContaining({
                appliedCount: 1,
                failedCount: 0,
            })
        );
    });

    it('returns the durable apply result when audit logging fails after apply', async () => {
        vi.mocked(recordStructureAuditBestEffort).mockRejectedValueOnce(new Error('audit unavailable'));

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(updateStructureImportRunStatus).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                runId: 'run-1',
                status: 'applied',
            })
        );
    });

    it('blocks apply when the fresh preflight report is not fully ready', async () => {
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValueOnce(
            ok(createFluxerStructure({ channelName: 'changed' }))
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({
            type: 'preflight-blocked',
            report: {
                summary: {
                    ready: 0,
                    stale: 1,
                },
            },
        });
        expect(updateStructureImportRunStatus).not.toHaveBeenCalled();
        expect(createStructureBackup).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('lets the atomic applying transition reject a concurrent apply before any external mutation', async () => {
        vi.mocked(updateStructureImportRunStatus).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toStrictEqual({ type: 'database-error' });
        expect(createStructureBackup).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
        expect(updateStructureImportActionStatus).not.toHaveBeenCalled();
    });

    it('applies ready category and channel creates with source-to-target mapping', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createCreateImportRun()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure({ includeCategory: false })));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({
                actions: [
                    { id: 'action-create-category', status: 'applied', createdId: 'created-category-1' },
                    { id: 'action-create-channel', status: 'applied', createdId: 'created-channel-1' },
                ],
                idMap: {
                    'source-category-1': 'created-category-1',
                    'source-channel-1': 'created-channel-1',
                },
            })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(createStructureBackup).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [
                    expect.objectContaining({
                        actionType: 'create',
                        targetType: 'category',
                        targetId: 'source-category-1',
                    }),
                    expect.objectContaining({
                        actionType: 'create',
                        targetType: 'channel',
                        targetId: 'source-channel-1',
                    }),
                ],
            })
        );
        expect(updateStructureImportActionStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionId: 'action-create-category',
                status: 'applied',
                details: expect.objectContaining({
                    sourceId: 'source-category-1',
                    createdId: 'created-category-1',
                }),
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                runId: 'run-1',
                status: 'applied',
                plan: expect.objectContaining({
                    applySummary: expect.objectContaining({
                        sourceTargetMap: {
                            'source-category-1': 'created-category-1',
                            'source-channel-1': 'created-channel-1',
                        },
                    }),
                }),
            })
        );
    });

    it('passes requested role order and matched role ids to Fluxer apply', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createRoleOrderImportRun()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure({ includeRole: true })));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({
                actions: [{ id: 'action-update-role', status: 'applied' }],
                idMap: { 'source-role-1': 'role-1' },
                roleOrder: { status: 'applied' },
            })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(applyFluxerBotGuildStructureActions).toHaveBeenCalledWith(
            expect.objectContaining({
                idMap: { 'source-role-1': 'role-1' },
                roleOrder: [{ sourceId: 'source-role-1', position: 5, hierarchyRank: 0 }],
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                status: 'applied',
                plan: expect.objectContaining({
                    applySummary: expect.objectContaining({
                        roleOrderStatus: 'applied',
                        sourceTargetMap: { 'source-role-1': 'role-1' },
                    }),
                }),
            })
        );
    });

    it('fails the import run when requested role ordering fails after ready actions apply', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createRoleOrderImportRun()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure({ includeRole: true })));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({
                actions: [{ id: 'action-update-role', status: 'applied' }],
                idMap: { 'source-role-1': 'role-1' },
                roleOrder: { status: 'failed', errorType: 'permission-denied' },
            })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'failed' });
        expect(updateStructureImportRunStatus).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                status: 'failed',
                plan: expect.objectContaining({
                    applySummary: expect.objectContaining({
                        roleOrderStatus: 'failed',
                        roleOrderErrorType: 'permission-denied',
                    }),
                }),
            })
        );
    });

    it('applies replace-mode reset deletes before creates', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createReplaceImportRun()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure({ includeRole: true })));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({
                actions: [
                    { id: 'action-delete-channel', status: 'applied' },
                    { id: 'action-delete-category', status: 'applied' },
                    { id: 'action-delete-role', status: 'applied' },
                    { id: 'action-create-role', status: 'applied', createdId: 'created-role-1' },
                ],
                idMap: {
                    'source-role-1': 'created-role-1',
                },
            })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
            destructiveConfirmationText: getStructureImportDeleteApprovalText('run-1', 3),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(applyFluxerBotGuildStructureActions).toHaveBeenCalledWith(
            expect.objectContaining({
                stopAfterDeleteFailures: true,
                actions: [
                    expect.objectContaining({
                        id: 'action-delete-channel',
                        actionType: 'delete',
                        targetType: 'channel',
                    }),
                    expect.objectContaining({
                        id: 'action-delete-category',
                        actionType: 'delete',
                        targetType: 'category',
                    }),
                    expect.objectContaining({
                        id: 'action-delete-role',
                        actionType: 'delete',
                        targetType: 'role',
                    }),
                    expect.objectContaining({
                        id: 'action-create-role',
                        actionType: 'create',
                        targetType: 'role',
                    }),
                ],
            })
        );
    });

    it('persists partial create failures with created ids for safe retry', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createCreateImportRun()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure({ includeCategory: false })));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({
                actions: [
                    { id: 'action-create-category', status: 'applied', createdId: 'created-category-1' },
                    {
                        id: 'action-create-channel',
                        status: 'failed',
                        createdId: 'created-channel-1',
                        errorType: 'partial-create-failed',
                        errorCauseType: 'permission-denied',
                    },
                ],
                idMap: {
                    'source-category-1': 'created-category-1',
                    'source-channel-1': 'created-channel-1',
                },
            })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'failed' });
        expect(updateStructureImportActionStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionId: 'action-create-channel',
                status: 'failed',
                details: expect.objectContaining({
                    sourceId: 'source-channel-1',
                    createdId: 'created-channel-1',
                    errorType: 'partial-create-failed',
                    errorCauseType: 'permission-denied',
                }),
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                runId: 'run-1',
                status: 'failed',
                plan: expect.objectContaining({
                    applySummary: expect.objectContaining({
                        sourceTargetMap: {
                            'source-category-1': 'created-category-1',
                            'source-channel-1': 'created-channel-1',
                        },
                    }),
                }),
            })
        );
    });

    it('marks missing apply action results failed instead of treating the run as applied', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createCreateImportRun()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure({ includeCategory: false })));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({
                actions: [{ id: 'action-create-category', status: 'applied', createdId: 'created-category-1' }],
                idMap: {
                    'source-category-1': 'created-category-1',
                },
            })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'failed' });
        expect(updateStructureImportActionStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionId: 'action-create-channel',
                status: 'failed',
                details: expect.objectContaining({
                    errorType: 'apply-result-missing',
                }),
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                runId: 'run-1',
                status: 'failed',
            })
        );
    });

    it('passes saved source-to-target mappings into retry apply calls', async () => {
        const retryRun: StructureImportRunWithActionsRecord = {
            ...createImportRun({
                plan: {
                    sourceTargetMap: {
                        'source-channel-1': 'created-channel-1',
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
            }),
            actions: [
                {
                    ...createActionRecord(),
                    id: 'retry-action-1',
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    details: {
                        label: 'announcements',
                        after: {
                            id: 'source-channel-1',
                            name: 'announcements',
                            type: 0,
                            parentId: null,
                            position: 1,
                            permissionOverwrites: [],
                        },
                        createdId: 'created-channel-1',
                        retryOfActionId: 'failed-action-1',
                    },
                },
            ],
        };
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValueOnce(ok(retryRun));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [],
                categories: [],
                channels: [
                    {
                        id: 'created-channel-1',
                        name: 'announcements',
                        type: 0,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            })
        );
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({
                actions: [{ id: 'retry-action-1', status: 'applied' }],
                idMap: {
                    'source-channel-1': 'created-channel-1',
                },
            })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(applyFluxerBotGuildStructureActions).toHaveBeenCalledWith(
            expect.objectContaining({
                idMap: {
                    'source-channel-1': 'created-channel-1',
                },
                actions: [
                    expect.objectContaining({
                        actionType: 'create',
                        targetId: 'source-channel-1',
                    }),
                ],
            })
        );
    });

    it('requires explicit destructive approval before reading structure for delete actions', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createDeleteImportRun()));

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toStrictEqual({
            type: 'destructive-confirmation-mismatch',
            expectedText: getStructureImportDeleteApprovalText('run-1', 1),
        });
        expect(readFluxerBotGuildStructure).not.toHaveBeenCalled();
        expect(createStructureBackup).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
        expect(updateStructureImportRunStatus).not.toHaveBeenCalled();
    });

    it('creates a restore-point backup before applying destructive delete actions', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createDeleteImportRun()));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({ actions: [{ id: 'action-delete-channel', status: 'applied' }], idMap: {} })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
            destructiveConfirmationText: getStructureImportDeleteApprovalText('run-1', 1),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(result).toMatchObject({ restorePointBackupId: 'backup-restore-1' });
        expect(createStructureBackup).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'guild-1',
                createdByUserId: 'actor-1',
                serverName: 'Guild One',
                source: 'restore_point',
                status: 'succeeded',
                structure: expect.objectContaining({
                    version: 1,
                    guildId: 'guild-1',
                    guildName: 'Guild 1',
                    roles: expect.any(Array),
                    categories: expect.any(Array),
                    channels: expect.any(Array),
                }),
                roleCount: 0,
                categoryCount: 1,
                channelCount: 1,
                audit: expect.objectContaining({
                    action: 'structure.backup_restore_point_created',
                    actorUserId: 'actor-1',
                    targetId: 'run-1',
                    metadata: expect.objectContaining({
                        deleteCount: 1,
                        permissionRiskCount: 0,
                        riskyActionCount: 1,
                        source: 'restore_point',
                    }),
                }),
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenNthCalledWith(
            1,
            {},
            expect.objectContaining({
                runId: 'run-1',
                status: 'applying',
            })
        );
        expect(vi.mocked(updateStructureImportRunStatus).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(createStructureBackup).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(vi.mocked(createStructureBackup).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(applyFluxerBotGuildStructureActions).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(applyFluxerBotGuildStructureActions).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actions: [
                {
                    id: 'action-delete-channel',
                    actionType: 'delete',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    changes: [],
                    after: undefined,
                },
            ],
            beforeMutation: expect.any(Function),
            stopAfterDeleteFailures: false,
        });
        expect(updateStructureImportActionStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionId: 'action-delete-channel',
                status: 'applied',
            })
        );
        expect(recordStructureAuditBestEffort).toHaveBeenCalledWith(
            expect.anything(),
            'structure.import_applied',
            'run-1',
            expect.objectContaining({
                deleteCount: 1,
                restorePointBackupId: 'backup-restore-1',
            })
        );
        expect(updateStructureImportRunStatus).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                plan: expect.objectContaining({
                    applySummary: expect.objectContaining({
                        restorePointBackupId: 'backup-restore-1',
                    }),
                }),
            })
        );
    });

    it('creates a restore-point backup before applying permission-risk updates', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createPermissionImportRun()));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({ actions: [{ id: 'action-permission-channel', status: 'applied' }], idMap: {} })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied', restorePointBackupId: 'backup-restore-1' });
        expect(createStructureBackup).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                source: 'restore_point',
                audit: expect.objectContaining({
                    metadata: expect.objectContaining({
                        deleteCount: 0,
                        permissionRiskCount: 1,
                        riskyActionCount: 1,
                    }),
                }),
            })
        );
        expect(applyFluxerBotGuildStructureActions).toHaveBeenCalled();
    });

    it('creates a restore-point backup before applying role permission updates', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createRolePermissionImportRun()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValueOnce(
            ok({
                ...createFluxerStructure(),
                roles: [
                    {
                        id: 'role-1',
                        name: 'Member',
                        position: 1,
                        permissions: '1024',
                        color: 0,
                        hoist: false,
                        mentionable: false,
                    },
                ],
            })
        );
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({ actions: [{ id: 'action-permission-role', status: 'applied' }], idMap: {} })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied', restorePointBackupId: 'backup-restore-1' });
        expect(createStructureBackup).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                source: 'restore_point',
                audit: expect.objectContaining({
                    metadata: expect.objectContaining({
                        deleteCount: 0,
                        permissionRiskCount: 1,
                        riskyActionCount: 1,
                    }),
                }),
            })
        );
    });

    it('blocks risky apply before Fluxer mutation when restore-point persistence returns an error', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createDeleteImportRun()));
        vi.mocked(createStructureBackup).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
            destructiveConfirmationText: getStructureImportDeleteApprovalText('run-1', 1),
        });

        expect(result).toStrictEqual({ type: 'restore-point-failed' });
        expect(updateStructureImportRunStatus).toHaveBeenCalledTimes(2);
        expect(updateStructureImportRunStatus).toHaveBeenNthCalledWith(
            2,
            {},
            expect.objectContaining({
                expectedApplyAttemptId: expect.any(String),
                expectedApplyLeaseOwner: expect.any(String),
                plan: expect.objectContaining({
                    applyAttempt: expect.objectContaining({ outcome: 'failed' }),
                }),
                runId: 'run-1',
                status: 'failed',
            })
        );
        expect(applyFluxerBotGuildStructureActions).not.toHaveBeenCalled();
    });

    it('keeps the restore point when Fluxer apply fails after backup creation', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createDeleteImportRun()));
        vi.mocked(applyFluxerBotGuildStructureActions).mockResolvedValueOnce(
            ok({
                actions: [{ id: 'action-delete-channel', status: 'failed', errorType: 'permission-denied' }],
                idMap: {},
            })
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
            destructiveConfirmationText: getStructureImportDeleteApprovalText('run-1', 1),
        });

        expect(result).toMatchObject({ type: 'failed', restorePointBackupId: 'backup-restore-1' });
        expect(createStructureBackup).toHaveBeenCalledOnce();
        expect(updateStructureImportRunStatus).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                status: 'failed',
                plan: expect.objectContaining({
                    applySummary: expect.objectContaining({
                        restorePointBackupId: 'backup-restore-1',
                    }),
                }),
            })
        );
    });
});

function createImportRun(overrides: Partial<StructureImportRunRecord> = {}): StructureImportRunWithActionsRecord {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');
    const run: StructureImportRunRecord = {
        id: 'run-1',
        guildId: 'guild-1',
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
        createdAt: timestamp,
        updatedAt: timestamp,
        confirmedAt: timestamp,
        appliedAt: null,
        ...overrides,
    };

    return {
        ...run,
        actions: [createActionRecord(run.id)],
    };
}

function createActionRecord(runId = 'run-1') {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');

    return {
        id: 'action-1',
        runId,
        sequence: 0,
        actionType: 'update',
        targetType: 'channel',
        targetId: 'channel-1',
        status: 'dry_run',
        details: {
            label: 'old-name',
            changes: [{ field: 'name', before: 'old-name', after: 'new-name' }],
        },
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function createCreateImportRun(): StructureImportRunWithActionsRecord {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');

    return {
        ...createImportRun({
            plan: {
                summary: {
                    creates: 2,
                    updates: 0,
                    deletes: 0,
                    roles: 0,
                    categories: 1,
                    channels: 1,
                },
            },
        }),
        actions: [
            {
                id: 'action-create-category',
                runId: 'run-1',
                sequence: 0,
                actionType: 'create',
                targetType: 'category',
                targetId: 'source-category-1',
                status: 'dry_run',
                details: {
                    label: 'Info',
                    after: {
                        id: 'source-category-1',
                        name: 'Info',
                        type: 4,
                        parentId: null,
                        position: 0,
                        permissionOverwrites: [],
                    },
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
            {
                id: 'action-create-channel',
                runId: 'run-1',
                sequence: 1,
                actionType: 'create',
                targetType: 'channel',
                targetId: 'source-channel-1',
                status: 'dry_run',
                details: {
                    label: 'announcements',
                    after: {
                        id: 'source-channel-1',
                        name: 'announcements',
                        type: 0,
                        parentId: 'source-category-1',
                        position: 1,
                        permissionOverwrites: [],
                    },
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        ],
    };
}

function createRoleOrderImportRun(): StructureImportRunWithActionsRecord {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');

    return {
        ...createImportRun({
            plan: {
                requestedSnapshot: {
                    version: 1,
                    guildId: 'source-guild-1',
                    roles: [
                        {
                            id: 'source-role-1',
                            name: 'Member',
                            position: 5,
                            hierarchyRank: 0,
                            color: 0,
                            permissions: '0',
                            hoist: false,
                            mentionable: false,
                        },
                    ],
                    categories: [],
                    channels: [],
                },
                requestedSnapshotVersion: 1,
                requestedSnapshotStoredAt: '2026-06-28T00:00:00.000Z',
                summary: {
                    creates: 0,
                    updates: 2,
                    deletes: 0,
                    roles: 2,
                    categories: 0,
                    channels: 0,
                },
            },
        }),
        actions: [
            {
                id: 'action-update-role',
                runId: 'run-1',
                sequence: 0,
                actionType: 'update',
                targetType: 'role',
                targetId: 'role-1',
                status: 'dry_run',
                details: {
                    label: 'Member',
                    sourceId: 'source-role-1',
                    changes: [{ field: 'name', before: 'Old Role', after: 'Member' }],
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
            {
                id: 'action-role-order',
                runId: 'run-1',
                sequence: 1,
                actionType: 'update',
                targetType: 'role-order',
                targetId: 'role-order',
                status: 'dry_run',
                details: {
                    label: 'Role order',
                    after: [{ sourceId: 'source-role-1', position: 5, hierarchyRank: 0 }],
                    changes: [
                        {
                            field: 'roleOrder',
                            after: [{ sourceId: 'source-role-1', position: 5, hierarchyRank: 0 }],
                        },
                    ],
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        ],
    };
}

function createDeleteImportRun(): StructureImportRunWithActionsRecord {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');

    return {
        ...createImportRun({
            plan: {
                summary: {
                    creates: 0,
                    updates: 0,
                    deletes: 1,
                    roles: 0,
                    categories: 0,
                    channels: 1,
                },
            },
        }),
        actions: [
            {
                id: 'action-delete-channel',
                runId: 'run-1',
                sequence: 0,
                actionType: 'delete',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                details: {
                    label: 'old-name',
                    before: {
                        id: 'channel-1',
                        name: 'old-name',
                        type: 0,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        ],
    };
}

function createReplaceImportRun(): StructureImportRunWithActionsRecord {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');

    return {
        ...createImportRun({
            plan: {
                importMode: 'replace',
                summary: {
                    creates: 1,
                    updates: 0,
                    deletes: 3,
                    roles: 2,
                    categories: 1,
                    channels: 1,
                },
            },
        }),
        actions: [
            {
                id: 'action-create-role',
                runId: 'run-1',
                sequence: 0,
                actionType: 'create',
                targetType: 'role',
                targetId: 'source-role-1',
                status: 'dry_run',
                details: {
                    label: 'New Role',
                    after: {
                        id: 'source-role-1',
                        name: 'New Role',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
            {
                id: 'action-delete-role',
                runId: 'run-1',
                sequence: 1,
                actionType: 'delete',
                targetType: 'role',
                targetId: 'role-1',
                status: 'dry_run',
                details: {
                    label: 'Old Role',
                    before: {
                        id: 'role-1',
                        name: 'Old Role',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
            {
                id: 'action-delete-category',
                runId: 'run-1',
                sequence: 2,
                actionType: 'delete',
                targetType: 'category',
                targetId: 'category-1',
                status: 'dry_run',
                details: {
                    label: 'Info',
                    before: {
                        id: 'category-1',
                        name: 'Info',
                        type: 4,
                        parentId: null,
                        position: 0,
                        permissionOverwrites: [],
                    },
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
            {
                id: 'action-delete-channel',
                runId: 'run-1',
                sequence: 3,
                actionType: 'delete',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                details: {
                    label: 'old-name',
                    before: {
                        id: 'channel-1',
                        name: 'old-name',
                        type: 0,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        ],
    };
}

function createPermissionImportRun(): StructureImportRunWithActionsRecord {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');

    return {
        ...createImportRun({
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
        }),
        actions: [
            {
                id: 'action-permission-channel',
                runId: 'run-1',
                sequence: 0,
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                details: {
                    label: 'old-name',
                    changes: [
                        {
                            field: 'permissionOverwrites',
                            before: [],
                            after: [
                                {
                                    id: 'guild-1',
                                    type: 0,
                                    allow: '1024',
                                    deny: '0',
                                },
                            ],
                        },
                    ],
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        ],
    };
}

function createRolePermissionImportRun(): StructureImportRunWithActionsRecord {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');

    return {
        ...createImportRun({
            plan: {
                summary: {
                    creates: 0,
                    updates: 1,
                    deletes: 0,
                    roles: 1,
                    categories: 0,
                    channels: 0,
                },
            },
        }),
        actions: [
            {
                id: 'action-permission-role',
                runId: 'run-1',
                sequence: 0,
                actionType: 'update',
                targetType: 'role',
                targetId: 'role-1',
                status: 'dry_run',
                details: {
                    label: 'Member',
                    changes: [{ field: 'permissions', before: '1024', after: '2048' }],
                },
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        ],
    };
}

function createRestorePointBackupRecord(): StructureBackupRecord {
    const timestamp = new Date('2026-06-28T00:00:00.000Z');

    return {
        id: 'backup-restore-1',
        guildId: 'guild-1',
        name: 'Guild One - restore point - 2026-06-28 - 00-00',
        createdByUserId: 'actor-1',
        source: 'restore_point',
        status: 'succeeded',
        errorMessage: null,
        structure: {
            version: 1,
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [],
        },
        roleCount: 0,
        categoryCount: 1,
        channelCount: 1,
        createdAt: timestamp,
        completedAt: timestamp,
    };
}

function createFluxerStructure({
    channelName = 'old-name',
    includeCategory = true,
    includeRole = false,
}: { channelName?: string; includeCategory?: boolean; includeRole?: boolean } = {}) {
    return {
        guildId: 'guild-1',
        guildName: 'Guild 1',
        roles: includeRole
            ? [
                  {
                      id: 'role-1',
                      name: 'Old Role',
                      position: 1,
                      color: 0,
                      permissions: '0',
                      hoist: false,
                      mentionable: false,
                  },
              ]
            : [],
        categories: includeCategory
            ? [
                  {
                      id: 'category-1',
                      name: 'Info',
                      type: 4,
                      parentId: null,
                      position: 0,
                      permissionOverwrites: [],
                  },
              ]
            : [],
        channels: [
            {
                id: 'channel-1',
                name: channelName,
                type: 0,
                parentId: null,
                position: 1,
                permissionOverwrites: [],
            },
        ],
    };
}
