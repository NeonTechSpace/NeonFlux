import { loadWebConfig } from '@neonflux/config';
import type * as NeonFluxConfig from '@neonflux/config';
import {
    findStructureImportRunByGuildId,
    updateStructureImportActionStatus,
    updateStructureImportRunStatus,
} from '@neonflux/db';
import type { StructureImportRunRecord, StructureImportRunWithActionsRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { applyFluxerBotGuildStructureAction, readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    applyDashboardStructureImportRun,
    getStructureImportApplyText,
    getStructureImportDeleteApprovalText,
} from './dashboard-structure-apply.server.js';
import { loadAuthorizedStructureContext, recordStructureAudit } from './dashboard-structure-context.server.js';

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
        findStructureImportRunByGuildId: vi.fn(),
        updateStructureImportActionStatus: vi.fn(),
        updateStructureImportRunStatus: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

    return {
        ...actual,
        applyFluxerBotGuildStructureAction: vi.fn(),
        readFluxerBotGuildStructure: vi.fn(),
    };
});

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-structure-context.server.js', () => ({
    loadAuthorizedStructureContext: vi.fn(),
    recordStructureAudit: vi.fn(),
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
        vi.mocked(findStructureImportRunByGuildId).mockResolvedValue(ok(createImportRun()));
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
        vi.mocked(applyFluxerBotGuildStructureAction).mockResolvedValue(ok({}));
        vi.mocked(recordStructureAudit).mockResolvedValue('recorded');
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
        expect(findStructureImportRunByGuildId).not.toHaveBeenCalled();
        expect(applyFluxerBotGuildStructureAction).not.toHaveBeenCalled();
    });

    it('applies preflight-ready channel name updates and records action results', async () => {
        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(updateStructureImportRunStatus).toHaveBeenNthCalledWith(1, {}, { runId: 'run-1', status: 'applying' });
        expect(applyFluxerBotGuildStructureAction).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'update',
            targetType: 'channel',
            targetId: 'channel-1',
            changes: [{ field: 'name', before: 'old-name', after: 'new-name' }],
            after: undefined,
            idMap: {},
        });
        expect(updateStructureImportActionStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionId: 'action-1',
                status: 'applied',
            })
        );
        expect(recordStructureAudit).toHaveBeenCalledWith(
            expect.anything(),
            'structure.import_applied',
            'run-1',
            expect.objectContaining({
                appliedCount: 1,
                failedCount: 0,
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
        expect(applyFluxerBotGuildStructureAction).not.toHaveBeenCalled();
    });

    it('applies ready category and channel creates with source-to-target mapping', async () => {
        vi.mocked(findStructureImportRunByGuildId).mockResolvedValue(ok(createCreateImportRun()));
        vi.mocked(readFluxerBotGuildStructure).mockResolvedValue(ok(createFluxerStructure({ includeCategory: false })));
        vi.mocked(applyFluxerBotGuildStructureAction)
            .mockResolvedValueOnce(ok({ createdId: 'created-category-1' }))
            .mockResolvedValueOnce(ok({ createdId: 'created-channel-1' }));

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(applyFluxerBotGuildStructureAction).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                actionType: 'create',
                targetType: 'category',
                targetId: 'source-category-1',
                idMap: {},
            })
        );
        expect(applyFluxerBotGuildStructureAction).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                actionType: 'create',
                targetType: 'channel',
                targetId: 'source-channel-1',
                idMap: {
                    'source-category-1': 'created-category-1',
                },
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

    it('requires explicit destructive approval before reading structure for delete actions', async () => {
        vi.mocked(findStructureImportRunByGuildId).mockResolvedValue(ok(createDeleteImportRun()));

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
        expect(applyFluxerBotGuildStructureAction).not.toHaveBeenCalled();
        expect(updateStructureImportRunStatus).not.toHaveBeenCalled();
    });

    it('applies destructive delete actions only after destructive approval', async () => {
        vi.mocked(findStructureImportRunByGuildId).mockResolvedValue(ok(createDeleteImportRun()));

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            confirmationText: getStructureImportApplyText('run-1'),
            destructiveConfirmationText: getStructureImportDeleteApprovalText('run-1', 1),
        });

        expect(result).toMatchObject({ type: 'applied' });
        expect(applyFluxerBotGuildStructureAction).toHaveBeenCalledWith({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'delete',
            targetType: 'channel',
            targetId: 'channel-1',
            changes: [],
            after: undefined,
            idMap: {},
        });
        expect(updateStructureImportActionStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionId: 'action-delete-channel',
                status: 'applied',
            })
        );
        expect(recordStructureAudit).toHaveBeenCalledWith(
            expect.anything(),
            'structure.import_applied',
            'run-1',
            expect.objectContaining({
                deleteCount: 1,
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

function createFluxerStructure({
    channelName = 'old-name',
    includeCategory = true,
}: { channelName?: string; includeCategory?: boolean } = {}) {
    return {
        guildId: 'guild-1',
        roles: [],
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
