// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    DashboardStructureDriftResult,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import { DashboardStructureExplorer } from './dashboard-structure-explorer.js';
import type { DashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-model.js';

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

const renderedExplorers: RenderResult[] = [];

describe('DashboardStructureExplorer', () => {
    afterEach(() => {
        for (const renderedExplorer of renderedExplorers.splice(0)) {
            renderedExplorer.unmount();
        }
    });

    it('prompts for loading a snapshot and exposes focused source actions', () => {
        const onLoadLive = vi.fn();
        const onInspectImportJson = vi.fn();

        renderExplorer({
            onInspectImportJson,
            onLoadLive,
            source: { label: 'No snapshot', type: 'none' },
        });

        expect(screen.getByText('No blueprint loaded')).toBeTruthy();
        fireEvent.change(screen.getByRole('combobox', { name: 'Load blueprint source' }), {
            target: { value: 'live' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Load blueprint source' }), {
            target: { value: 'import-json' },
        });

        expect(onLoadLive).toHaveBeenCalledOnce();
        expect(onInspectImportJson).toHaveBeenCalledOnce();
    });

    it('uses a named container and presents source and target as one comparison toolbar', () => {
        renderExplorer({
            comparisonTarget: { label: 'Nightly backup', detail: 'Jul 9, 2026', type: 'backup' },
            source: {
                label: 'Live server layout',
                detail: 'Loaded just now',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
        });

        expect(screen.getByLabelText('Server blueprint explorer').className).toContain('@container/blueprint-explorer');
        expect(screen.getByTestId('blueprint-explorer-workbench').className).toContain(
            '@min-[48rem]/blueprint-explorer:grid-cols-'
        );
        expect(screen.getByText('Source')).toBeTruthy();
        expect(screen.getByText('Target')).toBeTruthy();
        expect(screen.getByText('Nightly backup')).toBeTruthy();
    });

    it('renders loaded hierarchy and default details', () => {
        renderExplorer({
            source: {
                label: 'Live server layout',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
        });

        expect(screen.getByRole('treeitem', { name: 'Roles/Admin' })).toBeTruthy();
        expect(screen.getByRole('treeitem', { name: 'Categories/General/general' })).toBeTruthy();
        expect(screen.getByText('Entity key')).toBeTruthy();
        expect(screen.getByText('role:role-admin')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('explains JSON diff requirements before a source is loaded', () => {
        renderExplorer();

        expect(screen.getByRole('button', { name: 'JSON diff' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('shows an empty JSON diff state until a comparison target is chosen', () => {
        renderExplorer({
            source: {
                canonicalJson: createExplorerCanonicalJson(),
                label: 'Live server layout',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
        });

        fireEvent.click(screen.getByRole('button', { name: 'JSON diff' }));

        expect(screen.getByText('Choose a comparison target to render a JSON diff.')).toBeTruthy();
        expect(screen.getAllByText('Live server layout').length).toBeGreaterThan(0);
        expect(screen.getAllByText('No comparison').length).toBeGreaterThan(0);
    });

    it('renders a raw JSON diff for a selected comparison target', () => {
        renderExplorer({
            comparisonTarget: {
                canonicalJson: createExplorerCanonicalJson({ channelName: 'announcements' }),
                label: 'Import JSON',
                type: 'import-json',
            },
            source: {
                canonicalJson: createExplorerCanonicalJson(),
                label: 'Live server layout',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
        });

        fireEvent.click(screen.getByRole('button', { name: 'JSON diff' }));

        expect(screen.getByTestId('mock-json-diff').textContent).toContain('Import JSON.json');
    });

    it('shows no-difference and capped states without rendering the diff component', () => {
        const canonicalJson = createExplorerCanonicalJson();
        const { unmount } = render(
            <DashboardStructureExplorer
                busyAction={undefined}
                comparisonTarget={{ canonicalJson, label: 'Import JSON', type: 'import-json' }}
                drift={undefined}
                overlayMode='none'
                preflightByRunId={{}}
                runs={[]}
                selectedEntityKey={undefined}
                source={{
                    canonicalJson,
                    label: 'Live server layout',
                    snapshot: createExplorerSnapshot(),
                    type: 'live',
                }}
                onCompareDriftBaseline={vi.fn()}
                onCompareImportJson={vi.fn()}
                onCompareLive={vi.fn()}
                onCompareRequestedFinalState={vi.fn()}
                onInspectImportJson={vi.fn()}
                onInspectRequestedFinalState={vi.fn()}
                onLoadActions={vi.fn()}
                onLoadLive={vi.fn()}
                onOverlayModeChange={vi.fn()}
                onSelectedEntityKeyChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'JSON diff' }));

        expect(screen.getByText('No JSON differences found.')).toBeTruthy();
        expect(screen.queryByTestId('mock-json-diff')).toBeNull();

        unmount();

        renderExplorer({
            comparisonTarget: {
                canonicalJson: 'b'.repeat(130_000),
                label: 'Import JSON',
                type: 'import-json',
            },
            source: {
                canonicalJson: 'a'.repeat(130_000),
                label: 'Live server layout',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
        });

        fireEvent.click(screen.getByRole('button', { name: 'JSON diff' }));

        expect(screen.getByText('JSON diff is too large to render inline.')).toBeTruthy();
        expect(screen.queryByTestId('mock-json-diff')).toBeNull();
    });

    it('runs compare actions and switches to JSON diff mode', () => {
        const onCompareImportJson = vi.fn();
        const onCompareLive = vi.fn();
        const onCompareDriftBaseline = vi.fn();

        renderExplorer({
            comparisonTarget: {
                canonicalJson: createExplorerCanonicalJson({ channelName: 'announcements' }),
                label: 'Import JSON',
                type: 'import-json',
            },
            drift: createDriftResult(),
            source: {
                canonicalJson: createExplorerCanonicalJson(),
                label: 'Live server layout',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
            onCompareDriftBaseline,
            onCompareImportJson,
            onCompareLive,
        });

        const targetSelect = screen.getByRole('combobox', { name: 'Choose comparison target' });
        fireEvent.change(targetSelect, { target: { value: 'import-json' } });
        fireEvent.change(targetSelect, { target: { value: 'live' } });
        fireEvent.change(targetSelect, { target: { value: 'drift-baseline' } });

        expect(onCompareImportJson).toHaveBeenCalledOnce();
        expect(onCompareLive).toHaveBeenCalledOnce();
        expect(onCompareDriftBaseline).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'JSON diff' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('shows requested final-state actions only for dry-runs with persisted requested snapshots', () => {
        const onCompareRequestedFinalState = vi.fn();
        const onInspectRequestedFinalState = vi.fn();
        const runWithSnapshot = createImportRun({ requestedSnapshot: createRequestedSnapshot() });

        const { unmount } = renderExplorer({
            overlayMode: 'run:run-1',
            runs: [runWithSnapshot],
            source: {
                canonicalJson: createExplorerCanonicalJson(),
                label: 'Live server layout',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
            onCompareRequestedFinalState,
            onInspectRequestedFinalState,
        });

        fireEvent.change(screen.getByRole('combobox', { name: 'Load blueprint source' }), {
            target: { value: 'requested-final' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Choose comparison target' }), {
            target: { value: 'requested-final' },
        });

        expect(onInspectRequestedFinalState).toHaveBeenCalledWith(runWithSnapshot);
        expect(onCompareRequestedFinalState).toHaveBeenCalledWith(runWithSnapshot);
        expect(screen.getByRole('button', { name: 'JSON diff' }).getAttribute('aria-pressed')).toBe('true');

        unmount();

        renderExplorer({
            overlayMode: 'run:run-1',
            runs: [createImportRun()],
            source: {
                canonicalJson: createExplorerCanonicalJson(),
                label: 'Live server layout',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
        });

        expect(screen.queryByRole('option', { name: 'Requested final state' })).toBeNull();
    });

    it('shows capped drift copy and risk details for selected drift targets', () => {
        renderExplorer({
            drift: createDriftResult(),
            overlayMode: 'drift',
            selectedEntityKey: 'channel:channel-1',
            source: {
                label: 'Live server layout',
                snapshot: createExplorerSnapshot(),
                type: 'live',
            },
        });

        expect(screen.getByText('Drift preview is capped. Create a dry-run to inspect every action.')).toBeTruthy();
        expect(screen.getByText('permissionOverwrites')).toBeTruthy();
        expect(screen.getByText('Changes permissions.')).toBeTruthy();
    });

    it('shows the unloaded plan action CTA', () => {
        const onLoadActions = vi.fn();
        const run = createImportRun({
            actionCount: 2,
            actions: [
                {
                    id: 'action-1',
                    sequence: 0,
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'channel-new',
                    label: 'announcements',
                    details: {
                        createdId: 'created-channel-1',
                        sourceId: 'source-channel-1',
                    },
                },
            ],
        });

        renderExplorer({
            overlayMode: 'run:run-1',
            runs: [run],
            selectedEntityKey: 'channel:channel-new',
            source: {
                label: 'Import JSON',
                snapshot: createExplorerSnapshot(),
                type: 'import-json',
            },
            onLoadActions,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Load actions' }));

        expect(onLoadActions).toHaveBeenCalledWith(run);
    });
});

function renderExplorer(overrides: Partial<Parameters<typeof DashboardStructureExplorer>[0]> = {}) {
    const view = render(
        <DashboardStructureExplorer
            busyAction={undefined}
            drift={undefined}
            overlayMode='none'
            preflightByRunId={{}}
            runs={[]}
            selectedEntityKey={undefined}
            comparisonTarget={{ label: 'No comparison', type: 'none' }}
            source={{ label: 'No snapshot', type: 'none' }}
            onCompareDriftBaseline={vi.fn()}
            onCompareImportJson={vi.fn()}
            onCompareLive={vi.fn()}
            onCompareRequestedFinalState={vi.fn()}
            onInspectImportJson={vi.fn()}
            onInspectRequestedFinalState={vi.fn()}
            onLoadActions={vi.fn()}
            onLoadLive={vi.fn()}
            onOverlayModeChange={vi.fn()}
            onSelectedEntityKeyChange={vi.fn()}
            {...overrides}
        />
    );

    renderedExplorers.push(view);
    return view;
}

function createExplorerCanonicalJson({ channelName = 'general' }: { channelName?: string } = {}): string {
    return `${JSON.stringify(
        {
            categories: createExplorerSnapshot().categories,
            channels: createExplorerSnapshot().channels.map((channel) => ({ ...channel, name: channelName })),
            exportedAt: '2026-07-09T10:00:00.000Z',
            guildId: 'guild-1',
            roles: createExplorerSnapshot().roles,
            version: 1,
        },
        null,
        2
    )}\n`;
}

function createExplorerSnapshot(): DashboardStructureExplorerSnapshot {
    return {
        exportedAt: '2026-07-09T10:00:00.000Z',
        guildId: 'guild-1',
        version: 1,
        roles: [
            {
                color: 0,
                hoist: false,
                id: 'role-member',
                mentionable: false,
                name: 'Member',
                permissions: '1',
                position: 1,
            },
            {
                color: 0,
                hoist: true,
                id: 'role-admin',
                mentionable: true,
                name: 'Admin',
                permissions: '8',
                position: 5,
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
                name: 'general',
                parentId: 'category-general',
                permissionOverwrites: [],
                position: 1,
                type: 0,
            },
        ],
    };
}

function createRequestedSnapshot() {
    return {
        ...createExplorerSnapshot(),
        version: 1 as const,
    };
}

function createDriftResult(): Extract<DashboardStructureDriftResult, { type: 'structure-drift' }> {
    return {
        type: 'structure-drift',
        baseline: {
            id: 'backup-1',
            name: 'Nightly backup',
            source: 'scheduled',
            status: 'succeeded',
            createdAt: '2026-07-09T10:00:00.000Z',
            completedAt: '2026-07-09T10:00:00.000Z',
            roleCount: 1,
            categoryCount: 1,
            channelCount: 1,
        },
        checkedAt: '2026-07-09T11:00:00.000Z',
        fieldSummary: {
            names: 0,
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
                fields: ['permissionOverwrites'],
                details: {
                    changes: [{ field: 'permissionOverwrites', before: [], after: [{ id: 'role-admin' }] }],
                },
            },
        ],
        summary: {
            creates: 0,
            updates: 1,
            deletes: 0,
            roles: 0,
            categories: 0,
            channels: 1,
        },
    };
}

function createImportRun(overrides: Partial<DashboardStructureImportRun> = {}): DashboardStructureImportRun {
    return {
        id: 'run-1',
        status: 'failed',
        createdByUserId: 'actor-1',
        createdAt: '2026-07-09T11:30:00.000Z',
        updatedAt: '2026-07-09T11:31:00.000Z',
        summary: {
            creates: 1,
            updates: 0,
            deletes: 0,
            roles: 0,
            categories: 0,
            channels: 1,
        },
        actionCount: 1,
        actions: [],
        policy: 'synchronize',
        decisionSummary: {
            'no-op': 0,
            create: 1,
            update: 0,
            delete: 0,
            'unmanaged-retained': 0,
            'protected-retained': 0,
            'protected-omitted': 0,
            'blocked-ambiguous': 0,
            'blocked-unsupported': 0,
        },
        decisions: [],
        planDigest: 'plan-digest',
        deleteActionCount: 0,
        ...overrides,
    };
}
