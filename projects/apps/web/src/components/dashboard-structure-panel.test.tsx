// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    applyDashboardStructureImportRunRouteData,
    confirmDashboardStructureImportRunRouteData,
    downloadDashboardStructureExportRouteData,
    importDashboardStructureBackupRouteData,
    preflightDashboardStructureImportRunRouteData,
    readDashboardStructureSettingsRouteData,
} from '../server/dashboard-structure-route-data.js';
import type * as DashboardStructureRouteDataModule from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import { DashboardStructurePanel } from './dashboard-structure-panel.js';

vi.mock('../server/dashboard-structure-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardStructureRouteDataModule>();

    return {
        ...actual,
        applyDashboardStructureImportRunRouteData: vi.fn(),
        confirmDashboardStructureImportRunRouteData: vi.fn(),
        downloadDashboardStructureExportRouteData: vi.fn(),
        importDashboardStructureBackupRouteData: vi.fn(),
        preflightDashboardStructureImportRunRouteData: vi.fn(),
        readDashboardStructureSettingsRouteData: vi.fn(),
    };
});

const renderedPanels: RenderResult[] = [];

describe('DashboardStructurePanel', () => {
    afterEach(() => {
        for (const renderedPanel of renderedPanels.splice(0)) {
            renderedPanel.unmount();
        }
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('downloads current server blueprint JSON without creating a backup', async () => {
        const click = vi.fn();
        const createObjectUrl = vi.fn(() => 'blob:structure-export');
        const revokeObjectUrl = vi.fn();

        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: createObjectUrl,
            revokeObjectURL: revokeObjectUrl,
        });
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createSettingsResult());
        vi.mocked(downloadDashboardStructureExportRouteData).mockResolvedValue({
            type: 'structure-export-created',
            fileName: 'neonflux-server-blueprint-guild-1-2026-07-06T10-00-00-000Z.json',
            structureJson: '{"version":1}',
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Download JSON' }));

        await waitFor(() => expect(downloadDashboardStructureExportRouteData).toHaveBeenCalled());
        expect(downloadDashboardStructureExportRouteData).toHaveBeenCalledWith({ data: { guildId: 'guild-1' } });
        expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
        expect(click).toHaveBeenCalledOnce();
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:structure-export');
        expect(await screen.findByText('Current server blueprint downloaded. No backup was created.')).toBeTruthy();
    });

    it('loads a server blueprint JSON file into the dry-run input', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createSettingsResult());

        renderStructurePanel();

        expect(await screen.findByText(/channel\/category name and permission-overwrite updates/u)).toBeTruthy();
        expect(screen.getByText(/Topic, NSFW, slowmode, ordering, parent moves/u)).toBeTruthy();
        const fileInput = await screen.findByLabelText('Import JSON file');
        const file = new File(['{"version":1}'], 'server-blueprint.json', { type: 'application/json' });

        fireEvent.change(fileInput, { target: { files: [file] } });

        expect(
            await screen.findByText('Loaded server-blueprint.json. Create a dry-run to review changes.')
        ).toBeTruthy();
        expect(screen.getByDisplayValue('{"version":1}')).toBeTruthy();
    });

    it('creates a dry-run from a persisted backup', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ backups: [createBackupSummary()] })
        );
        vi.mocked(importDashboardStructureBackupRouteData).mockResolvedValue({
            type: 'backup-import-created',
            importRun: createImportRun({ actionCount: 2 }),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Create dry-run from backup' }));

        await waitFor(() => expect(importDashboardStructureBackupRouteData).toHaveBeenCalled());
        expect(importDashboardStructureBackupRouteData).toHaveBeenCalledWith({
            data: { backupId: 'backup-1', guildId: 'guild-1' },
        });
        expect(await screen.findByText('Dry-run created from backup with 2 planned changes.')).toBeTruthy();
    });

    it('confirms a reviewed dry-run without applying server changes', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createSettingsResult());
        vi.mocked(confirmDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'confirmed',
            importRun: createImportRun({ status: 'confirmed' }),
        });

        renderStructurePanel();

        const confirmationInput = await screen.findByLabelText('Type CONFIRM run-1 to confirm review');
        const confirmButton = screen.getByRole('button', { name: 'Confirm' });

        expect(confirmButton.hasAttribute('disabled')).toBe(true);

        fireEvent.change(confirmationInput, { target: { value: 'CONFIRM run-1' } });
        await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(false));
        fireEvent.click(confirmButton);

        await waitFor(() => expect(confirmDashboardStructureImportRunRouteData).toHaveBeenCalled());
        expect(confirmDashboardStructureImportRunRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                importRunId: 'run-1',
                confirmationText: 'CONFIRM run-1',
            },
        });
        expect(await screen.findByText('Dry-run confirmed. No server changes were applied.')).toBeTruthy();
    });

    it('does not show confirmation controls for already confirmed runs', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ importRuns: [createImportRun({ status: 'confirmed' })] })
        );

        renderStructurePanel();

        expect(await screen.findByText('confirmed')).toBeTruthy();
        expect(screen.queryByLabelText('Type CONFIRM run-1 to confirm review')).toBeNull();
    });

    it('shows failed action causes in import history', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                importRuns: [
                    createImportRun({
                        status: 'failed',
                        actions: [
                            {
                                id: 'action-1',
                                sequence: 0,
                                actionType: 'create',
                                targetType: 'channel',
                                targetId: 'source-channel-1',
                                status: 'failed',
                                label: 'announcements',
                                details: {
                                    sourceId: 'source-channel-1',
                                    createdId: 'created-channel-1',
                                    errorType: 'partial-create-failed',
                                    errorCauseType: 'permission-denied',
                                },
                            },
                        ],
                    }),
                ],
            })
        );

        renderStructurePanel();

        expect(await screen.findByText('source-channel-1 -> created-channel-1')).toBeTruthy();
        expect(screen.getByText('partial-create-failed: permission-denied')).toBeTruthy();
    });

    it('runs non-mutating preflight for confirmed dry-runs', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ importRuns: [createImportRun({ status: 'confirmed' })] })
        );
        vi.mocked(preflightDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'preflight',
            importRunId: 'run-1',
            report: {
                summary: {
                    total: 1,
                    ready: 1,
                    stale: 0,
                    mappingRequired: 0,
                    destructiveApprovalRequired: 0,
                    unsupported: 0,
                    invalidPlan: 0,
                },
                actions: [
                    {
                        actionId: 'action-1',
                        actionType: 'update',
                        targetType: 'channel',
                        targetId: 'channel-1',
                        label: 'general',
                        status: 'ready',
                        message: 'The target still matches the dry-run baseline.',
                    },
                ],
            },
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Run preflight' }));

        await waitFor(() => expect(preflightDashboardStructureImportRunRouteData).toHaveBeenCalled());
        expect(preflightDashboardStructureImportRunRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                importRunId: 'run-1',
            },
        });
        expect(
            await screen.findByText(
                '1 ready, 0 stale, 0 mapping required, 0 destructive approval, 0 unsupported, 0 invalid.'
            )
        ).toBeTruthy();
    });

    it('requires typed confirmation before applying a clean preflight', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ importRuns: [createImportRun({ status: 'confirmed' })] })
        );
        vi.mocked(preflightDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'preflight',
            importRunId: 'run-1',
            report: createReadyPreflightReport(),
        });
        vi.mocked(applyDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'applied',
            importRun: createImportRun({ status: 'applied' }),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Run preflight' }));
        const applyInput = await screen.findByLabelText('Type APPLY run-1 to apply ready updates');
        const applyButton = screen.getByRole('button', { name: 'Apply' });

        expect(
            await screen.findByText(/role name, color, hoist, mentionability, and permission updates/u)
        ).toBeTruthy();
        expect(applyButton.hasAttribute('disabled')).toBe(true);

        fireEvent.change(applyInput, { target: { value: 'APPLY run-1' } });
        await waitFor(() => expect(applyButton.hasAttribute('disabled')).toBe(false));
        fireEvent.click(applyButton);

        await waitFor(() => expect(applyDashboardStructureImportRunRouteData).toHaveBeenCalled());
        expect(applyDashboardStructureImportRunRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                importRunId: 'run-1',
                confirmationText: 'APPLY run-1',
            },
        });
    });

    it('requires a second typed confirmation before applying destructive deletes', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ importRuns: [createDeleteImportRun()] })
        );
        vi.mocked(preflightDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'preflight',
            importRunId: 'run-1',
            report: createDestructivePreflightReport(),
        });
        vi.mocked(applyDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'applied',
            importRun: createDeleteImportRun({ status: 'applied' }),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Run preflight' }));
        const applyInput = await screen.findByLabelText('Type APPLY run-1 to apply ready updates');
        const deleteInput = await screen.findByLabelText('Type DELETE run-1 1 to approve 1 delete');
        const applyButton = screen.getByRole('button', { name: 'Apply' });

        fireEvent.change(applyInput, { target: { value: 'APPLY run-1' } });
        expect(applyButton.hasAttribute('disabled')).toBe(true);

        fireEvent.change(deleteInput, { target: { value: 'DELETE run-1 1' } });
        await waitFor(() => expect(applyButton.hasAttribute('disabled')).toBe(false));
        fireEvent.click(applyButton);

        await waitFor(() => expect(applyDashboardStructureImportRunRouteData).toHaveBeenCalled());
        expect(applyDashboardStructureImportRunRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                importRunId: 'run-1',
                confirmationText: 'APPLY run-1',
                destructiveConfirmationText: 'DELETE run-1 1',
            },
        });
    });

    it('shows the latest observed server layout change when tracking has data', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                observedState: {
                    changedSinceLastBackup: true,
                    observedChangeCount: 2,
                    targetChangeCounts: { channel: 2 },
                    lastEventType: 'channel.updated',
                    lastObservedAt: '2026-06-26T10:30:00.000Z',
                },
            })
        );

        renderStructurePanel();

        expect(await screen.findByText(/2 observed server layout changes/u)).toBeTruthy();
    });
});

function renderStructurePanel(): void {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    const view = render(
        <QueryClientProvider client={queryClient}>
            <DashboardStructurePanel guildId='guild-1' />
        </QueryClientProvider>
    );
    renderedPanels.push(view);
}

function createSettingsResult(
    overrides: {
        backups?: ReturnType<typeof createBackupSummary>[];
        importRuns?: DashboardStructureImportRun[];
        observedState?: {
            changedSinceLastBackup: boolean;
            observedChangeCount: number;
            targetChangeCounts: Record<string, number>;
            lastEventType?: string;
            lastObservedAt?: string;
        };
    } = {}
) {
    return {
        type: 'settings' as const,
        backups: overrides.backups ?? [],
        backupSettings: {
            enabled: false,
            cadenceWeeks: 1,
            retentionDays: 180,
        },
        importRuns: overrides.importRuns ?? [createImportRun()],
        observedState: overrides.observedState ?? {
            changedSinceLastBackup: false,
            observedChangeCount: 0,
            targetChangeCounts: {},
        },
    };
}

function createBackupSummary() {
    return {
        id: 'backup-1',
        name: 'NeonSpace - 2026-07-06 - 10-00',
        source: 'manual',
        status: 'succeeded',
        createdAt: '2026-07-06T10:00:00.000Z',
        completedAt: '2026-07-06T10:00:00.000Z',
        roleCount: 1,
        categoryCount: 1,
        channelCount: 1,
    };
}

function createImportRun(overrides: Partial<DashboardStructureImportRun> = {}): DashboardStructureImportRun {
    return {
        id: 'run-1',
        status: 'dry_run_complete',
        createdByUserId: 'actor-1',
        createdAt: '2026-06-26T10:05:00.000Z',
        updatedAt: '2026-06-26T10:05:01.000Z',
        summary: {
            creates: 0,
            updates: 1,
            deletes: 0,
            roles: 0,
            categories: 0,
            channels: 1,
        },
        actionCount: 1,
        actions: [
            {
                id: 'action-1',
                sequence: 0,
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                label: 'general',
                details: {
                    label: 'general',
                },
            },
        ],
        ...overrides,
    };
}

function createDeleteImportRun(overrides: Partial<DashboardStructureImportRun> = {}): DashboardStructureImportRun {
    return createImportRun({
        status: 'confirmed',
        summary: {
            creates: 0,
            updates: 0,
            deletes: 1,
            roles: 0,
            categories: 0,
            channels: 1,
        },
        actions: [
            {
                id: 'action-1',
                sequence: 0,
                actionType: 'delete',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                label: 'general',
                details: {
                    label: 'general',
                },
            },
        ],
        ...overrides,
    });
}

function createReadyPreflightReport() {
    return {
        summary: {
            total: 1,
            ready: 1,
            stale: 0,
            mappingRequired: 0,
            destructiveApprovalRequired: 0,
            unsupported: 0,
            invalidPlan: 0,
        },
        actions: [
            {
                actionId: 'action-1',
                actionType: 'update' as const,
                targetType: 'channel' as const,
                targetId: 'channel-1',
                label: 'general',
                status: 'ready' as const,
                message: 'The target still matches the dry-run baseline.',
            },
        ],
    };
}

function createDestructivePreflightReport() {
    return {
        summary: {
            total: 1,
            ready: 0,
            stale: 0,
            mappingRequired: 0,
            destructiveApprovalRequired: 1,
            unsupported: 0,
            invalidPlan: 0,
        },
        actions: [
            {
                actionId: 'action-1',
                actionType: 'delete' as const,
                targetType: 'channel' as const,
                targetId: 'channel-1',
                label: 'general',
                status: 'destructive-approval-required' as const,
                message: 'Delete actions require destructive approval.',
            },
        ],
    };
}
