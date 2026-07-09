// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    applyDashboardStructureImportRunRouteData,
    confirmDashboardStructureImportRunRouteData,
    createDashboardStructureDryRunRouteData,
    downloadDashboardStructureExportRouteData,
    importDashboardStructureBackupRouteData,
    preflightDashboardStructureImportRunRouteData,
    readDashboardStructureBackupPageRouteData,
    readDashboardStructureBackupJsonRouteData,
    readDashboardStructureDriftRouteData,
    readDashboardStructureImportActionPageRouteData,
    readDashboardStructureSettingsRouteData,
} from '../server/dashboard-structure-route-data.js';
import type * as DashboardStructureRouteDataModule from '../server/dashboard-structure-route-data.js';
import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
    DashboardStructureDriftResult,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import { DashboardStructurePanel } from './dashboard-structure-panel.js';

vi.mock('../server/dashboard-structure-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardStructureRouteDataModule>();

    return {
        ...actual,
        applyDashboardStructureImportRunRouteData: vi.fn(),
        confirmDashboardStructureImportRunRouteData: vi.fn(),
        createDashboardStructureDryRunRouteData: vi.fn(),
        downloadDashboardStructureExportRouteData: vi.fn(),
        importDashboardStructureBackupRouteData: vi.fn(),
        preflightDashboardStructureImportRunRouteData: vi.fn(),
        readDashboardStructureBackupPageRouteData: vi.fn(),
        readDashboardStructureBackupJsonRouteData: vi.fn(),
        readDashboardStructureDriftRouteData: vi.fn(),
        readDashboardStructureImportActionPageRouteData: vi.fn(),
        readDashboardStructureSettingsRouteData: vi.fn(),
    };
});

vi.mock('@pierre/trees/react', () => ({
    FileTree: ({ model }: { model: MockTreeModel }) => (
        <div aria-label='Mock blueprint tree' role='tree'>
            {model.paths.map((path) => (
                <button
                    key={path}
                    type='button'
                    role='treeitem'
                    aria-selected={model.selectedPaths.includes(path)}
                    onClick={() => model.selectPath(path)}>
                    {path}
                </button>
            ))}
        </div>
    ),
    useFileTree: ({ initialSelectedPaths = [], preparedInput }: MockUseFileTreeInput) => {
        const model: MockTreeModel = {
            paths: [...preparedInput.paths],
            selectedPaths: [...initialSelectedPaths],
            getItem: (path: string) => ({
                select: () => {
                    model.selectedPaths = [path];
                },
            }),
            scrollToPath: vi.fn(),
            selectPath: (path: string) => {
                model.selectedPaths = [path];
            },
        };

        return { model };
    },
    useFileTreeSelection: (model: MockTreeModel) => model.selectedPaths,
}));

vi.mock('@pierre/diffs/react', () => ({
    FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => (
        <div data-testid='mock-json-diff'>Mock JSON diff: {fileDiff.name}</div>
    ),
}));

type MockTreeModel = {
    getItem: (path: string) => { select: () => void } | undefined;
    paths: string[];
    scrollToPath: ReturnType<typeof vi.fn>;
    selectedPaths: string[];
    selectPath: (path: string) => void;
};

type MockUseFileTreeInput = {
    initialSelectedPaths?: string[];
    preparedInput: {
        paths: readonly string[];
    };
};

const renderedPanels: RenderResult[] = [];

describe('DashboardStructurePanel', () => {
    afterEach(() => {
        for (const renderedPanel of renderedPanels.splice(0)) {
            renderedPanel.unmount();
        }
        vi.useRealTimers();
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

        expect(await screen.findByText(/channel\/category name, position, parent/u)).toBeTruthy();
        expect(screen.getByText(/Topic, NSFW, slowmode, type changes, and moving @everyone are blocked/u)).toBeTruthy();
        const fileInput = await screen.findByLabelText('Import JSON file');
        const file = new File(['{"version":1}'], 'server-blueprint.json', { type: 'application/json' });

        fireEvent.change(fileInput, { target: { files: [file] } });

        expect(
            await screen.findByText('Loaded server-blueprint.json. Create a dry-run to review changes.')
        ).toBeTruthy();
        expect(screen.getByDisplayValue('{"version":1}')).toBeTruthy();
    });

    it('creates JSON dry-runs in merge mode by default', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createSettingsResult());
        vi.mocked(createDashboardStructureDryRunRouteData).mockResolvedValue({
            type: 'dry-run-created',
            importRun: createImportRun({ actionCount: 1 }),
        });

        renderStructurePanel();

        fireEvent.change(await screen.findByLabelText('Import JSON dry-run'), {
            target: { value: createStructureJson() },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create dry-run' }));

        await waitFor(() => expect(createDashboardStructureDryRunRouteData).toHaveBeenCalled());
        expect(createDashboardStructureDryRunRouteData).toHaveBeenCalledWith({
            data: { guildId: 'guild-1', backupJson: createStructureJson(), importMode: 'merge' },
        });
        expect(await screen.findByText('Merge dry-run created with 1 planned changes.')).toBeTruthy();
    });

    it('creates replace-mode JSON dry-runs when the replace checkbox is checked', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createSettingsResult());
        vi.mocked(createDashboardStructureDryRunRouteData).mockResolvedValue({
            type: 'dry-run-created',
            importRun: createImportRun({ actionCount: 4 }),
        });

        renderStructurePanel();

        fireEvent.change(await screen.findByLabelText('Import JSON dry-run'), {
            target: { value: createStructureJson() },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: /Reset existing layout before import/u }));
        fireEvent.click(screen.getByRole('button', { name: 'Create dry-run' }));

        await waitFor(() => expect(createDashboardStructureDryRunRouteData).toHaveBeenCalled());
        expect(createDashboardStructureDryRunRouteData).toHaveBeenCalledWith({
            data: { guildId: 'guild-1', backupJson: createStructureJson(), importMode: 'replace' },
        });
        expect(
            await screen.findByText(
                'Reset-first dry-run created with 4 planned changes. Review deletes before applying.'
            )
        ).toBeTruthy();
    });

    it('creates a restore dry-run from a persisted restore-point backup', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ backups: [createBackupSummary({ source: 'restore_point' })] })
        );
        vi.mocked(importDashboardStructureBackupRouteData).mockResolvedValue({
            type: 'backup-import-created',
            importRun: createImportRun({ actionCount: 2 }),
        });

        renderStructurePanel();

        expect(await screen.findByText('Restore point')).toBeTruthy();
        fireEvent.click((await screen.findAllByRole('button', { name: 'Create restore dry-run' }))[0]);

        await waitFor(() => expect(importDashboardStructureBackupRouteData).toHaveBeenCalled());
        expect(importDashboardStructureBackupRouteData).toHaveBeenCalledWith({
            data: { backupId: 'backup-1', guildId: 'guild-1' },
        });
        expect(
            await screen.findByText('Restore dry-run created with 2 planned changes. Review it before applying.')
        ).toBeTruthy();
    });

    it('keeps the generic dry-run label for regular backup rows', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ backups: [createBackupSummary({ source: 'scheduled' })] })
        );

        renderStructurePanel();

        expect(await screen.findByRole('button', { name: 'Create dry-run from backup' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Create restore dry-run' })).toBeNull();
    });

    it('checks drift against the latest regular backup', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ backups: [createBackupSummary()] })
        );
        vi.mocked(readDashboardStructureDriftRouteData).mockResolvedValue(createDriftResult());

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Check latest' }));

        await waitFor(() => expect(readDashboardStructureDriftRouteData).toHaveBeenCalled());
        expect(readDashboardStructureDriftRouteData).toHaveBeenCalledWith({ data: { guildId: 'guild-1' } });
        expect(await screen.findByText('2 drift changes found')).toBeTruthy();
        expect(screen.getByText('Permissions')).toBeTruthy();
        expect(
            screen.getByText('Preview is capped. Create a dry-run from the baseline to review every action.')
        ).toBeTruthy();
    });

    it('loads live server layout into the explorer without downloading a file', async () => {
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
            fileName: 'live.json',
            structureJson: createStructureJson(),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Load live' }));

        await waitFor(() => expect(downloadDashboardStructureExportRouteData).toHaveBeenCalled());
        expect(downloadDashboardStructureExportRouteData).toHaveBeenCalledWith({ data: { guildId: 'guild-1' } });
        expect(click).not.toHaveBeenCalled();
        expect(createObjectUrl).not.toHaveBeenCalled();
        expect(revokeObjectUrl).not.toHaveBeenCalled();
        expect(await screen.findByText('Live server blueprint loaded in explorer.')).toBeTruthy();
        expect(screen.getAllByText('Live server layout').length).toBeGreaterThan(0);
        expect(screen.getByRole('treeitem', { name: 'Categories/General/general' })).toBeTruthy();
    });

    it('inspects a successful backup row in the explorer', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ backups: [createBackupSummary()] })
        );
        vi.mocked(readDashboardStructureBackupJsonRouteData).mockResolvedValue({
            type: 'backup-json',
            backupId: 'backup-1',
            fileName: 'backup.json',
            backupJson: createStructureJson(),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Inspect backup' }));

        await waitFor(() => expect(readDashboardStructureBackupJsonRouteData).toHaveBeenCalled());
        expect(readDashboardStructureBackupJsonRouteData).toHaveBeenCalledWith({
            data: { backupId: 'backup-1', guildId: 'guild-1' },
        });
        expect(await screen.findByText('Backup loaded in explorer.')).toBeTruthy();
        expect(screen.getAllByText('NeonSpace - 2026-07-06 - 10-00').length).toBeGreaterThan(0);
        expect(screen.getByRole('treeitem', { name: 'Roles/Admin' })).toBeTruthy();
    });

    it('preserves the prior explorer snapshot when import JSON is invalid', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createSettingsResult());
        vi.mocked(downloadDashboardStructureExportRouteData).mockResolvedValue({
            type: 'structure-export-created',
            fileName: 'live.json',
            structureJson: createStructureJson(),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Load live' }));
        expect(await screen.findByText('Live server blueprint loaded in explorer.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Import JSON dry-run'), { target: { value: '{' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Inspect import JSON' })[0]);

        expect(await screen.findByText('Import JSON could not be parsed as a server blueprint.')).toBeTruthy();
        expect(screen.getAllByText('Live server layout').length).toBeGreaterThan(0);
        expect(screen.getByRole('treeitem', { name: 'Roles/Admin' })).toBeTruthy();
    });

    it('compares the loaded explorer source against import JSON and preserves the target on invalid JSON', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createSettingsResult());
        vi.mocked(downloadDashboardStructureExportRouteData).mockResolvedValue({
            type: 'structure-export-created',
            fileName: 'live.json',
            structureJson: createStructureJson(),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Load live' }));
        await screen.findByText('Live server blueprint loaded in explorer.');
        fireEvent.change(screen.getByLabelText('Import JSON dry-run'), {
            target: { value: createStructureJson({ channelName: 'announcements' }) },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Compare import JSON' }));

        expect(await screen.findByText('Import JSON comparison loaded.')).toBeTruthy();
        expect(screen.getByTestId('mock-json-diff').textContent).toContain('Import JSON.json');

        fireEvent.change(screen.getByLabelText('Import JSON dry-run'), { target: { value: '{' } });
        fireEvent.click(screen.getByRole('button', { name: 'Compare import JSON' }));

        expect(await screen.findByText('Import JSON could not be parsed as a server blueprint.')).toBeTruthy();
        expect(screen.getByTestId('mock-json-diff').textContent).toContain('Import JSON.json');
    });

    it('compares the loaded explorer source against live layout without downloading a file', async () => {
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
            fileName: 'live.json',
            structureJson: createStructureJson(),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Load live' }));
        await screen.findByText('Live server blueprint loaded in explorer.');
        fireEvent.click(screen.getByRole('button', { name: 'Compare live' }));

        await waitFor(() => expect(downloadDashboardStructureExportRouteData).toHaveBeenCalledTimes(2));
        expect(click).not.toHaveBeenCalled();
        expect(createObjectUrl).not.toHaveBeenCalled();
        expect(revokeObjectUrl).not.toHaveBeenCalled();
        expect(await screen.findByText('Live server blueprint comparison loaded.')).toBeTruthy();
        expect(screen.getByText('No JSON differences found.')).toBeTruthy();
    });

    it('compares the loaded explorer source against the latest drift baseline backup', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ backups: [createBackupSummary()] })
        );
        vi.mocked(downloadDashboardStructureExportRouteData).mockResolvedValue({
            type: 'structure-export-created',
            fileName: 'live.json',
            structureJson: createStructureJson(),
        });
        vi.mocked(readDashboardStructureDriftRouteData).mockResolvedValue(createDriftResult());
        vi.mocked(readDashboardStructureBackupJsonRouteData).mockResolvedValue({
            type: 'backup-json',
            backupId: 'backup-1',
            fileName: 'backup.json',
            backupJson: createStructureJson({ channelName: 'baseline-general' }),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Load live' }));
        await screen.findByText('Live server blueprint loaded in explorer.');
        fireEvent.click(screen.getByRole('button', { name: 'Check latest' }));
        await screen.findByText('2 drift changes found');
        fireEvent.click(screen.getByRole('button', { name: 'Compare drift baseline' }));

        await waitFor(() => expect(readDashboardStructureBackupJsonRouteData).toHaveBeenCalled());
        expect(readDashboardStructureBackupJsonRouteData).toHaveBeenCalledWith({
            data: { backupId: 'backup-1', guildId: 'guild-1' },
        });
        expect(await screen.findByText('Drift baseline comparison loaded.')).toBeTruthy();
        expect(screen.getByTestId('mock-json-diff').textContent).toContain('NeonSpace - 2026-07-06 - 10-00.json');
    });

    it('selects a drift preview target in the explorer', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ backups: [createBackupSummary()] })
        );
        vi.mocked(downloadDashboardStructureExportRouteData).mockResolvedValue({
            type: 'structure-export-created',
            fileName: 'live.json',
            structureJson: createStructureJson(),
        });
        vi.mocked(readDashboardStructureDriftRouteData).mockResolvedValue(createDriftResult());

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Load live' }));
        await screen.findByText('Live server blueprint loaded in explorer.');
        fireEvent.click(screen.getByRole('button', { name: 'Check latest' }));
        await screen.findByText('2 drift changes found');
        fireEvent.click(screen.getByRole('button', { name: /updatechannelgeneralname, permissionOverwrites/u }));

        expect(await screen.findByText('channel:channel-1')).toBeTruthy();
        expect(screen.getByText('Changes permissions.')).toBeTruthy();
    });

    it('selects a dry-run action in the explorer after loading actions', async () => {
        const unloadedRun = createImportRun({ actionCount: 1, actions: [] });

        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ importRuns: [unloadedRun] })
        );
        vi.mocked(downloadDashboardStructureExportRouteData).mockResolvedValue({
            type: 'structure-export-created',
            fileName: 'live.json',
            structureJson: createStructureJson(),
        });
        vi.mocked(readDashboardStructureImportActionPageRouteData).mockResolvedValue({
            type: 'action-page',
            page: {
                actions: createImportRun().actions,
            },
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Load live' }));
        await screen.findByText('Live server blueprint loaded in explorer.');
        fireEvent.click(await screen.findByRole('button', { name: 'Load actions' }));

        await waitFor(() => expect(readDashboardStructureImportActionPageRouteData).toHaveBeenCalled());
        expect(readDashboardStructureImportActionPageRouteData).toHaveBeenCalledWith({
            data: { guildId: 'guild-1', importRunId: 'run-1', limit: 100 },
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Inspect' }));

        expect(await screen.findByText('channel:channel-1')).toBeTruthy();
        expect(screen.getByText('update channel')).toBeTruthy();
    });

    it('loads and compares a dry-run requested final state in the explorer', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                importRuns: [
                    createImportRun({
                        requestedSnapshot: JSON.parse(createStructureJson({ channelName: 'announcements' })),
                    }),
                ],
            })
        );
        vi.mocked(downloadDashboardStructureExportRouteData).mockResolvedValue({
            type: 'structure-export-created',
            fileName: 'live.json',
            structureJson: createStructureJson(),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Load live' }));
        await screen.findByText('Live server blueprint loaded in explorer.');
        fireEvent.change(screen.getByLabelText('Overlay'), { target: { value: 'run:run-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Compare requested final state' }));

        expect(
            await screen.findByText(
                'Requested final-state comparison loaded. This is the dry-run target, not applied state.'
            )
        ).toBeTruthy();
        expect(screen.getByTestId('mock-json-diff').textContent).toContain('Requested final state.json');

        fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
        fireEvent.click(screen.getByRole('button', { name: 'Inspect requested final state' }));

        expect(
            await screen.findByText(
                'Requested final state loaded. This is the dry-run target, not the current server state.'
            )
        ).toBeTruthy();
        expect(screen.getAllByText('Requested final state').length).toBeGreaterThan(0);
    });

    it('checks drift against a selected backup row and can create a dry-run from that baseline', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ backups: [createBackupSummary({ id: 'backup-selected' })] })
        );
        vi.mocked(readDashboardStructureDriftRouteData).mockResolvedValue(
            createDriftResult({ baseline: createBackupSummary({ id: 'backup-selected' }) })
        );
        vi.mocked(importDashboardStructureBackupRouteData).mockResolvedValue({
            type: 'backup-import-created',
            importRun: createImportRun({ actionCount: 2 }),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Check drift against this backup' }));

        await waitFor(() => expect(readDashboardStructureDriftRouteData).toHaveBeenCalled());
        expect(readDashboardStructureDriftRouteData).toHaveBeenCalledWith({
            data: { baselineBackupId: 'backup-selected', guildId: 'guild-1' },
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Create dry-run from baseline' }));

        await waitFor(() => expect(importDashboardStructureBackupRouteData).toHaveBeenCalled());
        expect(importDashboardStructureBackupRouteData).toHaveBeenCalledWith({
            data: { backupId: 'backup-selected', guildId: 'guild-1' },
        });
    });

    it('shows no-baseline drift errors without creating a dry-run', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createSettingsResult());
        vi.mocked(readDashboardStructureDriftRouteData).mockResolvedValue({ type: 'no-baseline' });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Check latest' }));

        expect(
            await screen.findByText('Create a successful server blueprint backup before checking drift.')
        ).toBeTruthy();
        expect(importDashboardStructureBackupRouteData).not.toHaveBeenCalled();
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
            restorePointBackupId: 'backup-restore-1',
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
        expect(await screen.findByText(/Restore point saved before apply/u)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create restore dry-run' })).toBeTruthy();
        expect(applyDashboardStructureImportRunRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                importRunId: 'run-1',
                confirmationText: 'APPLY run-1',
            },
        });
    });

    it('creates a restore dry-run from the post-apply restore point shortcut', async () => {
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
            restorePointBackupId: 'backup-restore-1',
        });
        vi.mocked(importDashboardStructureBackupRouteData).mockResolvedValue({
            type: 'backup-import-created',
            importRun: createImportRun({ id: 'restore-run-1', actionCount: 3 }),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Run preflight' }));
        fireEvent.change(await screen.findByLabelText('Type APPLY run-1 to apply ready updates'), {
            target: { value: 'APPLY run-1' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
        fireEvent.click((await screen.findAllByRole('button', { name: 'Create restore dry-run' }))[0]);

        await waitFor(() => expect(importDashboardStructureBackupRouteData).toHaveBeenCalled());
        expect(importDashboardStructureBackupRouteData).toHaveBeenCalledWith({
            data: { backupId: 'backup-restore-1', guildId: 'guild-1' },
        });
        expect(
            await screen.findByText('Restore dry-run created with 3 planned changes. Review it before applying.')
        ).toBeTruthy();
    });

    it('shows the restore shortcut notice after a failed apply creates a restore point', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ importRuns: [createImportRun({ status: 'confirmed' })] })
        );
        vi.mocked(preflightDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'preflight',
            importRunId: 'run-1',
            report: createReadyPreflightReport(),
        });
        vi.mocked(applyDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'failed',
            importRun: createImportRun({ status: 'failed' }),
            restorePointBackupId: 'backup-restore-1',
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Run preflight' }));
        fireEvent.change(await screen.findByLabelText('Type APPLY run-1 to apply ready updates'), {
            target: { value: 'APPLY run-1' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));

        expect(
            await screen.findByText(
                'Server blueprint apply finished with failures. Review action statuses before retrying.'
            )
        ).toBeTruthy();
        expect(screen.getByText('Restore point saved before apply.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create restore dry-run' })).toBeTruthy();
    });

    it('refreshes loaded backup pages after apply creates a restore point', async () => {
        const originalBackup = createBackupSummary({ id: 'backup-1', name: 'Original backup' });
        const loadedBackup = createBackupSummary({ id: 'backup-2', name: 'Loaded older backup' });
        const restorePointBackup = createBackupSummary({
            id: 'backup-restore-1',
            name: 'Restore point before apply',
            source: 'restore_point',
        });

        vi.mocked(readDashboardStructureSettingsRouteData)
            .mockResolvedValueOnce(
                createSettingsResult({
                    backupNextCursor: 'cursor-1',
                    backups: [originalBackup],
                    importRuns: [createImportRun({ status: 'confirmed' })],
                })
            )
            .mockResolvedValueOnce(
                createSettingsResult({
                    backups: [restorePointBackup, originalBackup],
                    importRuns: [createImportRun({ status: 'applied' })],
                })
            );
        vi.mocked(readDashboardStructureBackupPageRouteData).mockResolvedValue({
            type: 'backup-page',
            page: {
                backups: [loadedBackup],
            },
        });
        vi.mocked(preflightDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'preflight',
            importRunId: 'run-1',
            report: createReadyPreflightReport(),
        });
        vi.mocked(applyDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'applied',
            importRun: createImportRun({ status: 'applied' }),
            restorePointBackupId: 'backup-restore-1',
        });

        renderStructurePanel();

        expect(await screen.findByText('Original backup')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(await screen.findByText('Loaded older backup')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Run preflight' }));
        fireEvent.change(await screen.findByLabelText('Type APPLY run-1 to apply ready updates'), {
            target: { value: 'APPLY run-1' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));

        expect(await screen.findByText('Restore point before apply')).toBeTruthy();
        expect(screen.getByText('Restore point')).toBeTruthy();
    });

    it('shows restore shortcut errors without replacing the local import run on failure', async () => {
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
            restorePointBackupId: 'backup-restore-1',
        });
        vi.mocked(importDashboardStructureBackupRouteData).mockResolvedValue({
            type: 'backup-json-unavailable',
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Run preflight' }));
        fireEvent.change(await screen.findByLabelText('Type APPLY run-1 to apply ready updates'), {
            target: { value: 'APPLY run-1' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
        fireEvent.click((await screen.findAllByRole('button', { name: 'Create restore dry-run' }))[0]);

        expect(await screen.findByText('This backup does not have server blueprint JSON.')).toBeTruthy();
        expect(screen.queryByText(/Restore dry-run created with .* planned changes/u)).toBeNull();
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

    it('shows hard preflight blockers before destructive approvals and explains why apply is unavailable', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ importRuns: [createDeleteImportRun()] })
        );
        vi.mocked(preflightDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'preflight',
            importRunId: 'run-1',
            report: createUnsupportedAndDestructivePreflightReport(),
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Run preflight' }));

        expect(await screen.findByText('Apply blocked')).toBeTruthy();
        expect(
            screen.getByText(/Fix or remove 1 unsupported, stale, mapping-required, or invalid planned change/u)
        ).toBeTruthy();
        expect(screen.getByText('Delete approval is only available after hard blockers are gone.')).toBeTruthy();
        expect(screen.queryByLabelText('Type APPLY run-1 to apply ready updates')).toBeNull();
        expect(screen.queryByLabelText('Type DELETE run-1 1 to approve 1 delete')).toBeNull();

        const blockerItems = screen.getAllByRole('listitem');
        const unsupported = blockerItems.find((element) =>
            element.textContent.includes('unsupported: @everyone - @everyone cannot be moved.')
        );
        const destructive = blockerItems.find((element) =>
            element.textContent.includes(
                'destructive approval required: general - Delete actions require destructive approval.'
            )
        );
        expect(unsupported).toBeDefined();
        expect(destructive).toBeDefined();
        expect(unsupported!.compareDocumentPosition(destructive!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows a blocked apply message when restore-point backup creation fails', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({ importRuns: [createDeleteImportRun()] })
        );
        vi.mocked(preflightDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'preflight',
            importRunId: 'run-1',
            report: createDestructivePreflightReport(),
        });
        vi.mocked(applyDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'restore-point-failed',
        });

        renderStructurePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Run preflight' }));
        fireEvent.change(await screen.findByLabelText('Type APPLY run-1 to apply ready updates'), {
            target: { value: 'APPLY run-1' },
        });
        fireEvent.change(await screen.findByLabelText('Type DELETE run-1 1 to approve 1 delete'), {
            target: { value: 'DELETE run-1 1' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));

        expect(
            await screen.findByText('Apply was not started because NeonFlux could not save a restore point.')
        ).toBeTruthy();
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

    it('shows a scheduled backup warning when automatic backups have not succeeded', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                backupSettings: {
                    enabled: true,
                    lastAttemptAt: '2026-07-09T10:00:00.000Z',
                },
            })
        );

        renderStructurePanel();

        expect(await screen.findByText('Automatic backups have not succeeded yet.')).toBeTruthy();
        const reviewLink = screen.getByRole('link', { name: 'Review' });
        expect(reviewLink.getAttribute('href')).toBe('#server-blueprint-backup-settings');
    });

    it('shows a failed backup warning linked to the failed backup row', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                backups: [createBackupSummary({ errorMessage: 'Fluxer read failed', status: 'failed' })],
            })
        );

        renderStructurePanel();

        expect(await screen.findByText('Latest backup failed')).toBeTruthy();
        expect(screen.getAllByText('Fluxer read failed').length).toBeGreaterThan(0);
        const reviewLink = screen.getByRole('link', { name: 'Review' });
        expect(reviewLink.getAttribute('href')).toBe('#server-blueprint-backup-backup-1');
        expect(screen.getByRole('group', { name: 'Backup NeonSpace - 2026-07-06 - 10-00' }).id).toBe(
            'server-blueprint-backup-backup-1'
        );
    });

    it('shows overdue scheduled backup and retention prune warnings', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                backupSettings: {
                    enabled: true,
                    lastSuccessAt: '2000-01-01T12:00:00.000Z',
                    nextBackupAt: '2000-01-02T09:30:00.000Z',
                    nextRetentionPruneAt: '2000-01-02T09:30:00.000Z',
                },
            })
        );

        renderStructurePanel();

        expect(await screen.findByText('Scheduled backup is overdue.')).toBeTruthy();
        expect(screen.getByText('Retention prune is overdue.')).toBeTruthy();
    });

    it('does not render backup health notices for a healthy backup state', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                backups: [createBackupSummary({ source: 'scheduled' })],
                backupSettings: {
                    enabled: true,
                    lastAttemptAt: '2999-07-09T10:00:00.000Z',
                    lastSuccessAt: '2999-07-09T10:00:00.000Z',
                    nextBackupAt: '2999-07-16T10:00:00.000Z',
                    nextRetentionPruneAt: '2999-07-10T10:00:00.000Z',
                },
            })
        );

        renderStructurePanel();

        expect(await screen.findByText('Current backup available')).toBeTruthy();
        expect(screen.queryByLabelText('Backup health')).toBeNull();
    });

    it('does not let restore-point backups mask regular backup health warnings', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                backups: [
                    createBackupSummary({ id: 'restore-1', source: 'restore_point', status: 'succeeded' }),
                    createBackupSummary({
                        id: 'scheduled-1',
                        errorMessage: 'Scheduled read failed',
                        source: 'scheduled',
                        status: 'failed',
                    }),
                ],
            })
        );

        renderStructurePanel();

        expect(await screen.findByText('Latest backup failed')).toBeTruthy();
        expect(screen.getAllByText('Scheduled read failed').length).toBeGreaterThan(0);
        const reviewLink = screen.getByRole('link', { name: 'Review' });
        expect(reviewLink.getAttribute('href')).toBe('#server-blueprint-backup-scheduled-1');
    });

    it('renders changed scheduled drift status and reviews the stored baseline', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(
            createSettingsResult({
                backupSettings: {
                    enabled: true,
                    scheduledDrift: {
                        status: 'changed',
                        checkedAt: '2026-07-09T10:00:00.000Z',
                        nextCheckAt: '2026-07-10T10:00:00.000Z',
                        changeCount: 2,
                        baselineBackupId: 'baseline-1',
                        baselineName: 'Baseline backup',
                        hasMorePreview: false,
                        summary: {
                            creates: 1,
                            updates: 1,
                            deletes: 0,
                            roles: 1,
                            categories: 0,
                            channels: 1,
                        },
                    },
                },
            })
        );
        vi.mocked(readDashboardStructureDriftRouteData).mockResolvedValue(
            createDriftResult({ baseline: createBackupSummary({ id: 'baseline-1', name: 'Baseline backup' }) })
        );

        renderStructurePanel();

        expect(await screen.findByText('Scheduled drift found 2 changes.')).toBeTruthy();
        expect(screen.getByText('Baseline: Baseline backup.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Review drift' }));

        await waitFor(() => expect(readDashboardStructureDriftRouteData).toHaveBeenCalled());
        expect(readDashboardStructureDriftRouteData).toHaveBeenCalledWith({
            data: { guildId: 'guild-1', baselineBackupId: 'baseline-1' },
        });
    });

    it('renders clean, failed, and no-baseline scheduled drift statuses', async () => {
        vi.mocked(readDashboardStructureSettingsRouteData)
            .mockResolvedValueOnce(
                createSettingsResult({
                    backupSettings: {
                        enabled: true,
                        scheduledDrift: {
                            status: 'clean',
                            checkedAt: '2026-07-09T10:00:00.000Z',
                            nextCheckAt: '2026-07-10T10:00:00.000Z',
                            baselineName: 'Baseline backup',
                            hasMorePreview: false,
                        },
                    },
                })
            )
            .mockResolvedValueOnce(
                createSettingsResult({
                    backupSettings: {
                        enabled: true,
                        scheduledDrift: {
                            status: 'failed',
                            checkedAt: '2026-07-09T10:00:00.000Z',
                            errorMessage: 'Structure read failed: login-failed',
                            hasMorePreview: false,
                        },
                    },
                })
            )
            .mockResolvedValueOnce(
                createSettingsResult({
                    backupSettings: {
                        enabled: true,
                        scheduledDrift: {
                            status: 'no_baseline',
                            checkedAt: '2026-07-09T10:00:00.000Z',
                            hasMorePreview: false,
                        },
                    },
                })
            );

        renderStructurePanel();
        expect(await screen.findByText('No scheduled drift found.')).toBeTruthy();

        renderStructurePanel();
        expect(await screen.findByText('Scheduled drift check failed.')).toBeTruthy();
        expect(screen.getByText('Structure read failed: login-failed')).toBeTruthy();

        renderStructurePanel();
        expect(await screen.findByText('Scheduled drift needs a baseline.')).toBeTruthy();
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
        backupSettings?: Partial<{
            enabled: boolean;
            cadenceWeeks: number;
            retentionDays: number;
            lastAttemptAt: string;
            lastSuccessAt: string;
            lastErrorMessage: string;
            nextBackupAt: string;
            nextDriftCheckAt: string;
            nextRetentionPruneAt: string;
            scheduledDrift: NonNullable<DashboardStructureBackupSettings['scheduledDrift']>;
        }>;
        importRuns?: DashboardStructureImportRun[];
        backupNextCursor?: string;
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
        ...(overrides.backupNextCursor ? { backupNextCursor: overrides.backupNextCursor } : {}),
        backupSettings: {
            enabled: false,
            cadenceWeeks: 1,
            retentionDays: 180,
            ...overrides.backupSettings,
        },
        importRuns: overrides.importRuns ?? [createImportRun()],
        observedState: overrides.observedState ?? {
            changedSinceLastBackup: false,
            observedChangeCount: 0,
            targetChangeCounts: {},
        },
    };
}

function createBackupSummary(
    overrides: Partial<DashboardStructureBackupSummary> = {}
): DashboardStructureBackupSummary {
    return {
        ...createBackupSummaryBase(),
        ...overrides,
    };
}

function createBackupSummaryBase(): DashboardStructureBackupSummary {
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

function createStructureJson({ channelName = 'general' }: { channelName?: string } = {}): string {
    return JSON.stringify({
        version: 1,
        guildId: 'guild-1',
        exportedAt: '2026-07-09T10:00:00.000Z',
        roles: [
            {
                color: 0,
                hoist: true,
                id: 'role-admin',
                mentionable: true,
                name: 'Admin',
                permissions: '8',
                position: 5,
            },
            {
                color: 0,
                hoist: false,
                id: 'role-member',
                mentionable: false,
                name: 'Member',
                permissions: '1',
                position: 1,
            },
        ],
        categories: [
            {
                id: 'category-general',
                name: 'General',
                parentId: null,
                permissionOverwrites: [],
                position: 1,
                type: 4,
            },
        ],
        channels: [
            {
                id: 'channel-1',
                name: channelName,
                parentId: 'category-general',
                permissionOverwrites: [],
                position: 1,
                type: 0,
            },
        ],
    });
}

function createDriftResult(
    overrides: Partial<Extract<DashboardStructureDriftResult, { type: 'structure-drift' }>> = {}
): Extract<DashboardStructureDriftResult, { type: 'structure-drift' }> {
    return {
        type: 'structure-drift',
        baseline: createBackupSummary(),
        checkedAt: '2026-07-06T10:05:00.000Z',
        fieldSummary: {
            names: 1,
            parentMoves: 0,
            permissions: 1,
            positions: 0,
            roleVisuals: 0,
            typeChanges: 0,
        },
        hasMorePreview: true,
        liveCounts: {
            categories: 1,
            channels: 1,
            roles: 1,
        },
        previewActions: [
            {
                id: 'drift-1',
                sequence: 1,
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                label: 'general',
                fields: ['name', 'permissionOverwrites'],
                details: {
                    label: 'general',
                },
            },
        ],
        summary: {
            creates: 0,
            updates: 2,
            deletes: 0,
            roles: 0,
            categories: 0,
            channels: 2,
        },
        ...overrides,
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

function createUnsupportedAndDestructivePreflightReport() {
    return {
        summary: {
            total: 2,
            ready: 0,
            stale: 0,
            mappingRequired: 0,
            destructiveApprovalRequired: 1,
            unsupported: 1,
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
            {
                actionId: 'action-2',
                actionType: 'update' as const,
                targetType: 'role' as const,
                targetId: 'guild-1',
                label: '@everyone',
                status: 'unsupported' as const,
                message: '@everyone cannot be moved.',
            },
        ],
    };
}
