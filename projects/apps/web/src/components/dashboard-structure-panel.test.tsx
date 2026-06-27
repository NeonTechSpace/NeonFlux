// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    applyDashboardStructureImportRunRouteData,
    confirmDashboardStructureImportRunRouteData,
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
        vi.clearAllMocks();
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

    it('shows the latest observed structure change when tracking has data', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                observedState: {
                    observedChangeCount: 2,
                    lastEventType: 'channel.updated',
                    lastObservedAt: '2026-06-26T10:30:00.000Z',
                },
            })
        );

        renderStructurePanel();

        expect(await screen.findByText(/2 observed structure changes since tracking started/u)).toBeTruthy();
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
        importRuns?: DashboardStructureImportRun[];
        observedState?: { observedChangeCount: number; lastEventType?: string; lastObservedAt?: string };
    } = {}
) {
    return {
        type: 'settings' as const,
        exports: [],
        importRuns: overrides.importRuns ?? [createImportRun()],
        observedState: overrides.observedState ?? {
            observedChangeCount: 0,
        },
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
        actions: [
            {
                id: 'action-1',
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
