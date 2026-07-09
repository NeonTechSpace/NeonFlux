import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';
import { Eye, FileJson, GitCompareArrows, Loader2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type {
    DashboardStructureDriftResult,
    DashboardStructureImportAction,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { buildDashboardStructureExplorerJsonDiff } from './dashboard-structure-explorer-diff.js';
import { DashboardStructureExplorerJsonDiffView } from './dashboard-structure-explorer-json-diff.js';
import {
    buildDashboardStructureExplorerModel,
    readDashboardStructureExplorerEntityKey,
    toDashboardStructureExplorerActions,
    type DashboardStructureExplorerAction,
    type DashboardStructureExplorerEntityKey,
    type DashboardStructureExplorerModel,
    type DashboardStructureExplorerSnapshot,
} from './dashboard-structure-explorer-model.js';
import { DashboardStructureExplorerDetails } from './dashboard-structure-explorer-details.js';

export type DashboardStructureExplorerSource = {
    canonicalJson?: string;
    detail?: string;
    label: string;
    snapshot?: DashboardStructureExplorerSnapshot;
    type: 'backup' | 'import-json' | 'live' | 'none' | 'requested-final-state';
};

export type DashboardStructureExplorerComparisonTarget = {
    canonicalJson?: string;
    detail?: string;
    label: string;
    snapshot?: DashboardStructureExplorerSnapshot;
    type: 'backup' | 'import-json' | 'live' | 'none' | 'requested-final-state';
};

export type DashboardStructureExplorerOverlayMode = 'drift' | 'none' | `run:${string}`;

type DriftState = Extract<DashboardStructureDriftResult, { type: 'structure-drift' }>;

export function DashboardStructureExplorer({
    busyAction,
    drift,
    overlayMode,
    preflightByRunId,
    runs,
    selectedEntityKey,
    comparisonTarget,
    source,
    onCompareDriftBaseline,
    onCompareImportJson,
    onCompareLive,
    onCompareRequestedFinalState,
    onInspectImportJson,
    onInspectRequestedFinalState,
    onLoadActions,
    onLoadLive,
    onOverlayModeChange,
    onSelectedEntityKeyChange,
}: {
    busyAction: StructureBusyAction | undefined;
    drift: DriftState | undefined;
    overlayMode: DashboardStructureExplorerOverlayMode;
    preflightByRunId: Record<string, DashboardStructurePreflightReport>;
    runs: DashboardStructureImportRun[];
    selectedEntityKey: DashboardStructureExplorerEntityKey | undefined;
    comparisonTarget: DashboardStructureExplorerComparisonTarget;
    source: DashboardStructureExplorerSource;
    onCompareDriftBaseline: () => void;
    onCompareImportJson: () => void;
    onCompareLive: () => void;
    onCompareRequestedFinalState: (run: DashboardStructureImportRun) => void;
    onInspectImportJson: () => void;
    onInspectRequestedFinalState: (run: DashboardStructureImportRun) => void;
    onLoadActions: (run: DashboardStructureImportRun) => void;
    onLoadLive: () => void;
    onOverlayModeChange: (mode: DashboardStructureExplorerOverlayMode) => void;
    onSelectedEntityKeyChange: (key: DashboardStructureExplorerEntityKey | undefined) => void;
}) {
    const [viewMode, setViewMode] = useState<'diff' | 'tree'>('tree');
    const selectedRun = readSelectedRun(overlayMode, runs);
    const overlayActions = useMemo(
        () => readOverlayActions({ drift, overlayMode, preflightByRunId, selectedRun }),
        [drift, overlayMode, preflightByRunId, selectedRun]
    );
    const explorerModel = useMemo(
        () =>
            buildDashboardStructureExplorerModel({
                actions: overlayActions,
                driftPreviewCapped: overlayMode === 'drift' && drift?.hasMorePreview === true,
                preflightReport: selectedRun ? preflightByRunId[selectedRun.id] : undefined,
                snapshot: source.snapshot,
            }),
        [drift?.hasMorePreview, overlayActions, overlayMode, preflightByRunId, selectedRun, source.snapshot]
    );
    const selectedPath = selectedEntityKey ? explorerModel.entityPathByKey.get(selectedEntityKey) : undefined;
    const effectiveSelectedPath = selectedPath ?? explorerModel.defaultSelectedPath;
    const selectedMetadata = effectiveSelectedPath ? explorerModel.pathMetadata.get(effectiveSelectedPath) : undefined;
    const hasData = explorerModel.paths.some((path) => explorerModel.pathMetadata.get(path)?.kind !== 'root');
    const isLiveBusy = busyAction === 'explorer-live';
    const isCompareLiveBusy = busyAction === 'explorer-compare-live';
    const isCompareBaselineBusy = busyAction === 'explorer-compare-baseline';
    const isActionBusy = selectedRun ? busyAction === `actions:${selectedRun.id}` : false;
    const canCompare = Boolean(source.canonicalJson);
    const canCompareDriftBaseline = drift?.baseline.status === 'succeeded';
    const canInspectRequestedFinalState = Boolean(selectedRun?.requestedSnapshot);
    const jsonDiff = useMemo(
        () =>
            source.canonicalJson && comparisonTarget.canonicalJson
                ? buildDashboardStructureExplorerJsonDiff({
                      after: comparisonTarget.canonicalJson,
                      afterLabel: comparisonTarget.label,
                      before: source.canonicalJson,
                      beforeLabel: source.label,
                  })
                : undefined,
        [comparisonTarget.canonicalJson, comparisonTarget.label, source.canonicalJson, source.label]
    );

    return (
        <section
            className='rounded-md border border-neutral-800 bg-neutral-950/60'
            aria-label='Server blueprint explorer'>
            <div className='flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 px-3 py-3'>
                <div>
                    <p className='text-sm font-semibold text-white'>Blueprint explorer</p>
                    <p className='mt-1 text-xs leading-5 text-neutral-400'>
                        Inspect loaded roles, categories, channels, and review overlays.
                    </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                    <div className='inline-flex min-h-9 overflow-hidden rounded-md border border-neutral-700'>
                        <button
                            type='button'
                            aria-pressed={viewMode === 'tree'}
                            onClick={() => setViewMode('tree')}
                            className={`px-3 text-xs font-semibold transition ${
                                viewMode === 'tree'
                                    ? 'bg-neutral-800 text-white'
                                    : 'text-neutral-300 hover:bg-neutral-900 hover:text-white'
                            }`}>
                            Tree
                        </button>
                        <button
                            type='button'
                            aria-pressed={viewMode === 'diff'}
                            onClick={() => setViewMode('diff')}
                            disabled={!canCompare}
                            className={`border-l border-neutral-700 px-3 text-xs font-semibold transition ${
                                viewMode === 'diff'
                                    ? 'bg-neutral-800 text-white'
                                    : 'text-neutral-300 hover:bg-neutral-900 hover:text-white'
                            } disabled:cursor-not-allowed disabled:text-neutral-600`}>
                            JSON diff
                        </button>
                    </div>
                    <button
                        type='button'
                        onClick={onLoadLive}
                        disabled={Boolean(busyAction)}
                        className='inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        {isLiveBusy ? <Loader2 className='size-3.5 animate-spin' /> : <Eye className='size-3.5' />}
                        {isLiveBusy ? 'Loading live' : 'Load live'}
                    </button>
                    <button
                        type='button'
                        onClick={onInspectImportJson}
                        disabled={Boolean(busyAction)}
                        className='inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        <FileJson className='size-3.5' />
                        Inspect import JSON
                    </button>
                    <button
                        type='button'
                        onClick={() => {
                            setViewMode('diff');
                            onCompareImportJson();
                        }}
                        disabled={Boolean(busyAction) || !canCompare}
                        className='inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        <GitCompareArrows className='size-3.5' />
                        Compare import JSON
                    </button>
                    <button
                        type='button'
                        onClick={() => {
                            setViewMode('diff');
                            onCompareLive();
                        }}
                        disabled={Boolean(busyAction) || !canCompare}
                        className='inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        {isCompareLiveBusy ? (
                            <Loader2 className='size-3.5 animate-spin' />
                        ) : (
                            <GitCompareArrows className='size-3.5' />
                        )}
                        {isCompareLiveBusy ? 'Comparing live' : 'Compare live'}
                    </button>
                    {canCompareDriftBaseline ? (
                        <button
                            type='button'
                            onClick={() => {
                                setViewMode('diff');
                                onCompareDriftBaseline();
                            }}
                            disabled={Boolean(busyAction) || !canCompare}
                            className='inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                            {isCompareBaselineBusy ? (
                                <Loader2 className='size-3.5 animate-spin' />
                            ) : (
                                <GitCompareArrows className='size-3.5' />
                            )}
                            {isCompareBaselineBusy ? 'Comparing baseline' : 'Compare drift baseline'}
                        </button>
                    ) : null}
                    {canInspectRequestedFinalState && selectedRun ? (
                        <>
                            <button
                                type='button'
                                onClick={() => onInspectRequestedFinalState(selectedRun)}
                                disabled={Boolean(busyAction)}
                                className='inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                <Eye className='size-3.5' />
                                Inspect requested final state
                            </button>
                            <button
                                type='button'
                                onClick={() => {
                                    setViewMode('diff');
                                    onCompareRequestedFinalState(selectedRun);
                                }}
                                disabled={Boolean(busyAction) || !canCompare}
                                className='inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                <GitCompareArrows className='size-3.5' />
                                Compare requested final state
                            </button>
                        </>
                    ) : null}
                </div>
            </div>

            {viewMode === 'diff' ? (
                <DashboardStructureExplorerJsonDiffView
                    comparisonTarget={comparisonTarget}
                    jsonDiff={jsonDiff}
                    source={source}
                />
            ) : (
                <div className='grid gap-0 divide-y divide-neutral-800 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0'>
                    <div className='space-y-3 p-3'>
                        <ExplorerSourceControls
                            drift={drift}
                            overlayMode={overlayMode}
                            runs={runs}
                            source={source}
                            onOverlayModeChange={onOverlayModeChange}
                        />

                        {explorerModel.warnings.length > 0 ? (
                            <div className='space-y-1 rounded-md border border-amber-400/25 bg-amber-400/10 p-2'>
                                {explorerModel.warnings.map((warning) => (
                                    <p key={warning} className='text-xs leading-5 text-amber-100'>
                                        {warning}
                                    </p>
                                ))}
                            </div>
                        ) : null}

                        {selectedRun && selectedRun.actionCount > selectedRun.actions.length ? (
                            <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-950 p-2'>
                                <p className='text-xs leading-5 text-neutral-400'>
                                    Dry-run action list is not fully loaded.
                                </p>
                                <button
                                    type='button'
                                    onClick={() => onLoadActions(selectedRun)}
                                    disabled={Boolean(busyAction)}
                                    className='min-h-8 rounded-md border border-neutral-700 px-2 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                    {isActionBusy ? 'Loading' : 'Load actions'}
                                </button>
                            </div>
                        ) : null}

                        {hasData ? (
                            <StructureExplorerTree
                                explorerModel={explorerModel}
                                selectedPath={effectiveSelectedPath}
                                onSelectedPathChange={(path) => {
                                    const metadata = explorerModel.pathMetadata.get(path);
                                    onSelectedEntityKeyChange(metadata?.entityKey);
                                }}
                            />
                        ) : (
                            <div className='rounded-md border border-dashed border-neutral-700 bg-neutral-950 p-4'>
                                <p className='text-sm font-semibold text-neutral-100'>No blueprint loaded</p>
                                <p className='mt-2 text-xs leading-5 text-neutral-400'>
                                    Load the live server layout, inspect a backup, or inspect import JSON to start.
                                </p>
                            </div>
                        )}
                    </div>

                    <DashboardStructureExplorerDetails metadata={selectedMetadata} source={source} />
                </div>
            )}
        </section>
    );
}

function ExplorerSourceControls({
    drift,
    overlayMode,
    runs,
    source,
    onOverlayModeChange,
}: {
    drift: DriftState | undefined;
    overlayMode: DashboardStructureExplorerOverlayMode;
    runs: DashboardStructureImportRun[];
    source: DashboardStructureExplorerSource;
    onOverlayModeChange: (mode: DashboardStructureExplorerOverlayMode) => void;
}) {
    return (
        <div className='grid gap-2 sm:grid-cols-2'>
            <div className='rounded-md border border-neutral-800 bg-neutral-950 p-2'>
                <p className='text-xs font-medium text-neutral-500 uppercase'>Source</p>
                <p className='mt-1 text-sm font-semibold text-neutral-100'>{source.label}</p>
                {source.detail ? <p className='mt-1 text-xs text-neutral-500'>{source.detail}</p> : null}
            </div>
            <label className='block rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs font-medium text-neutral-300'>
                Overlay
                <select
                    value={overlayMode}
                    onChange={(event) =>
                        onOverlayModeChange(event.currentTarget.value as DashboardStructureExplorerOverlayMode)
                    }
                    className='mt-1 h-9 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                    <option value='none'>None</option>
                    <option value='drift' disabled={!drift}>
                        Latest drift
                    </option>
                    {runs.map((run) => (
                        <option key={run.id} value={`run:${run.id}`}>
                            Dry-run {formatDate(run.createdAt)}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    );
}

function StructureExplorerTree({
    explorerModel,
    selectedPath,
    onSelectedPathChange,
}: {
    explorerModel: DashboardStructureExplorerModel;
    selectedPath: string | undefined;
    onSelectedPathChange: (path: string) => void;
}) {
    return (
        <StructureExplorerTreeInstance
            key={explorerModel.paths.join('\n')}
            explorerModel={explorerModel}
            selectedPath={selectedPath}
            onSelectedPathChange={onSelectedPathChange}
        />
    );
}

function StructureExplorerTreeInstance({
    explorerModel,
    selectedPath,
    onSelectedPathChange,
}: {
    explorerModel: DashboardStructureExplorerModel;
    selectedPath: string | undefined;
    onSelectedPathChange: (path: string) => void;
}) {
    const { model } = useFileTree({
        fileTreeSearchMode: 'expand-matches',
        initialExpansion: 'open',
        initialSelectedPaths: selectedPath ? [selectedPath] : [],
        itemHeight: 28,
        overscan: 8,
        preparedInput: explorerModel.preparedInput,
        renderRowDecoration: ({ item }) => {
            const metadata = explorerModel.pathMetadata.get(item.path);
            const label = decorationForBadges(metadata?.badges ?? []);

            return label ? { text: label, title: metadata?.badges.join(', ') } : null;
        },
        search: true,
        unsafeCSS: `
            button[data-type='item'][data-item-selected] {
                background: rgba(56, 189, 248, 0.18);
                color: #f8fafc;
            }
        `,
    });
    const selectedPaths = useFileTreeSelection(model);

    useEffect(() => {
        if (!selectedPath) return;

        const item = model.getItem(selectedPath);
        item?.select();
        model.scrollToPath(selectedPath, { focus: false, offset: 'nearest' });
    }, [model, selectedPath]);

    useEffect(() => {
        const nextPath = selectedPaths[0];
        if (nextPath && nextPath !== selectedPath) onSelectedPathChange(nextPath);
    }, [onSelectedPathChange, selectedPath, selectedPaths]);

    return (
        <FileTree
            model={model}
            style={
                {
                    '--trees-border-color-override': '#262626',
                    '--trees-fg-override': '#d4d4d8',
                    '--trees-selected-bg-override': 'rgba(56, 189, 248, 0.18)',
                    height: '22rem',
                } as CSSProperties
            }
        />
    );
}

export function readDashboardStructureExplorerActionEntityKey(
    action: Pick<DashboardStructureImportAction, 'targetId' | 'targetType'>
): DashboardStructureExplorerEntityKey | undefined {
    return readDashboardStructureExplorerEntityKey(action);
}

function readOverlayActions({
    drift,
    overlayMode,
    preflightByRunId,
    selectedRun,
}: {
    drift: DriftState | undefined;
    overlayMode: DashboardStructureExplorerOverlayMode;
    preflightByRunId: Record<string, DashboardStructurePreflightReport>;
    selectedRun: DashboardStructureImportRun | undefined;
}): DashboardStructureExplorerAction[] {
    if (overlayMode === 'drift') return drift ? toDashboardStructureExplorerActions(drift.previewActions) : [];
    if (overlayMode === 'none' || !selectedRun) return [];

    return toDashboardStructureExplorerActions(selectedRun.actions, preflightByRunId[selectedRun.id]);
}

function readSelectedRun(
    overlayMode: DashboardStructureExplorerOverlayMode,
    runs: DashboardStructureImportRun[]
): DashboardStructureImportRun | undefined {
    if (!overlayMode.startsWith('run:')) return undefined;

    const runId = overlayMode.slice('run:'.length);
    return runs.find((run) => run.id === runId);
}

function decorationForBadges(badges: string[]): string | undefined {
    if (badges.includes('blocked')) return 'block';
    if (badges.includes('failed')) return 'fail';
    if (badges.includes('permissions')) return 'perm';
    if (badges.includes('delete')) return 'del';
    if (badges.includes('create')) return '+';
    if (badges.includes('update')) return 'upd';
    if (badges.includes('move')) return 'move';

    return undefined;
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}
