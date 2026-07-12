import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';
import { GitCompareArrows } from 'lucide-react';
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
} from './dashboard-structure-explorer-model.js';
import type {
    DashboardStructureExplorerAction,
    DashboardStructureExplorerEntityKey,
    DashboardStructureExplorerModel,
    DashboardStructureExplorerSnapshot,
} from './dashboard-structure-explorer-model.js';
import { DashboardStructureExplorerDetails } from './dashboard-structure-explorer-details.js';
import { dashboardCompactFieldClassName, dashboardQuietActionClassName } from './dashboard-ui.js';

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
            className='@container/blueprint-explorer min-w-0 overflow-hidden rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)]'
            aria-label='Server blueprint explorer'>
            <div className='border-b border-[var(--dash-border)]'>
                <div className='grid min-w-0 items-stretch @min-[46rem]/blueprint-explorer:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'>
                    <SnapshotIdentity detail={source.detail} label={source.label} slot='Source' />
                    <div className='hidden items-center justify-center border-x border-[var(--dash-border)] px-3 text-[var(--dash-text-subtle)] @min-[46rem]/blueprint-explorer:flex'>
                        <GitCompareArrows className='size-4' aria-hidden='true' />
                    </div>
                    <SnapshotIdentity detail={comparisonTarget.detail} label={comparisonTarget.label} slot='Target' />
                </div>

                <div className='flex min-w-0 flex-wrap items-end gap-x-5 gap-y-3 border-t border-[var(--dash-border)] px-3 py-2.5'>
                    <label className='min-w-[11rem] text-xs font-medium text-[var(--dash-text-muted)]'>
                        Load source
                        <select
                            aria-label='Load blueprint source'
                            value=''
                            onChange={(event) => {
                                const action = event.currentTarget.value;
                                if (action === 'live') onLoadLive();
                                if (action === 'import-json') onInspectImportJson();
                                if (action === 'requested-final' && selectedRun) {
                                    onInspectRequestedFinalState(selectedRun);
                                }
                            }}
                            disabled={Boolean(busyAction)}
                            className={`mt-1 ${dashboardCompactFieldClassName}`}>
                            <option value=''>{isLiveBusy ? 'Loading live layout' : 'Choose source'}</option>
                            <option value='live'>{isLiveBusy ? 'Loading live layout' : 'Live layout'}</option>
                            <option value='import-json'>Import JSON</option>
                            {canInspectRequestedFinalState ? (
                                <option value='requested-final'>Requested final state</option>
                            ) : null}
                        </select>
                    </label>

                    <label className='min-w-[12rem] text-xs font-medium text-[var(--dash-text-muted)]'>
                        Compare with
                        <select
                            aria-label='Choose comparison target'
                            value=''
                            onChange={(event) => {
                                const action = event.currentTarget.value;
                                if (!action) return;

                                setViewMode('diff');
                                if (action === 'live') onCompareLive();
                                if (action === 'import-json') onCompareImportJson();
                                if (action === 'drift-baseline') onCompareDriftBaseline();
                                if (action === 'requested-final' && selectedRun) {
                                    onCompareRequestedFinalState(selectedRun);
                                }
                            }}
                            disabled={Boolean(busyAction) || !canCompare}
                            className={`mt-1 ${dashboardCompactFieldClassName}`}>
                            <option value=''>
                                {isCompareLiveBusy
                                    ? 'Comparing live layout'
                                    : isCompareBaselineBusy
                                      ? 'Comparing drift baseline'
                                      : 'Choose target'}
                            </option>
                            <option value='live'>{isCompareLiveBusy ? 'Comparing live layout' : 'Live layout'}</option>
                            <option value='import-json'>Import JSON</option>
                            {canCompareDriftBaseline ? (
                                <option value='drift-baseline'>
                                    {isCompareBaselineBusy ? 'Comparing drift baseline' : 'Drift baseline'}
                                </option>
                            ) : null}
                            {canInspectRequestedFinalState ? (
                                <option value='requested-final'>Requested final state</option>
                            ) : null}
                        </select>
                    </label>

                    <div className='ml-auto flex min-h-9 items-end gap-4' aria-label='Explorer view'>
                        <button
                            type='button'
                            aria-pressed={viewMode === 'tree'}
                            onClick={() => setViewMode('tree')}
                            className={`h-9 border-b-2 px-1 text-xs font-semibold transition focus-visible:rounded-sm focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none ${
                                viewMode === 'tree'
                                    ? 'border-[var(--dash-primary)] text-[var(--dash-text)]'
                                    : 'border-transparent text-[var(--dash-text-muted)] hover:text-[var(--dash-text)]'
                            }`}>
                            Tree
                        </button>
                        <button
                            type='button'
                            aria-pressed={viewMode === 'diff'}
                            onClick={() => setViewMode('diff')}
                            disabled={!canCompare}
                            className={`h-9 border-b-2 px-1 text-xs font-semibold transition focus-visible:rounded-sm focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none ${
                                viewMode === 'diff'
                                    ? 'border-[var(--dash-primary)] text-[var(--dash-text)]'
                                    : 'border-transparent text-[var(--dash-text-muted)] hover:text-[var(--dash-text)]'
                            } disabled:cursor-not-allowed disabled:text-[var(--dash-text-disabled)]`}>
                            JSON diff
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'diff' ? (
                <DashboardStructureExplorerJsonDiffView
                    comparisonTarget={comparisonTarget}
                    jsonDiff={jsonDiff}
                    source={source}
                />
            ) : (
                <div
                    data-testid='blueprint-explorer-workbench'
                    className='grid min-w-0 divide-y divide-[var(--dash-border)] @min-[48rem]/blueprint-explorer:grid-cols-[minmax(17rem,0.82fr)_minmax(0,1.18fr)] @min-[48rem]/blueprint-explorer:divide-x @min-[48rem]/blueprint-explorer:divide-y-0'>
                    <div className='min-w-0 space-y-3 p-3'>
                        <ExplorerOverlayControl
                            drift={drift}
                            overlayMode={overlayMode}
                            runs={runs}
                            onOverlayModeChange={onOverlayModeChange}
                        />

                        {explorerModel.warnings.length > 0 ? (
                            <div className='space-y-1 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-2'>
                                {explorerModel.warnings.map((warning) => (
                                    <p key={warning} className='text-xs leading-5 text-[var(--dash-warning)]'>
                                        {warning}
                                    </p>
                                ))}
                            </div>
                        ) : null}

                        {selectedRun && selectedRun.actionCount > selectedRun.actions.length ? (
                            <div className='flex flex-wrap items-center justify-between gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] p-2'>
                                <p className='text-xs leading-5 text-[var(--dash-text-muted)]'>
                                    Dry-run action list is not fully loaded.
                                </p>
                                <button
                                    type='button'
                                    onClick={() => onLoadActions(selectedRun)}
                                    disabled={Boolean(busyAction)}
                                    className={`${dashboardQuietActionClassName} min-h-8 px-2 text-xs`}>
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
                            <div className='rounded-[var(--dash-radius-control)] border border-dashed border-[var(--dash-border-strong)] bg-[var(--dash-bg)] p-4'>
                                <p className='text-sm font-semibold text-[var(--dash-text)]'>No blueprint loaded</p>
                                <p className='mt-2 text-xs leading-5 text-[var(--dash-text-muted)]'>
                                    Load the live server layout, inspect a backup, or inspect import JSON to start.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className='min-w-0 @min-[48rem]/blueprint-explorer:max-h-[min(34rem,65dvh)] @min-[48rem]/blueprint-explorer:overflow-y-auto'>
                        <DashboardStructureExplorerDetails metadata={selectedMetadata} source={source} />
                    </div>
                </div>
            )}
        </section>
    );
}

function SnapshotIdentity({ detail, label, slot }: { detail?: string; label: string; slot: 'Source' | 'Target' }) {
    return (
        <div className='min-w-0 px-3 py-3'>
            <p className='text-xs font-medium text-[var(--dash-text-subtle)]'>{slot}</p>
            <p className='mt-1 truncate text-sm font-semibold text-[var(--dash-text)]'>{label}</p>
            {detail ? <p className='mt-0.5 truncate text-xs text-[var(--dash-text-subtle)]'>{detail}</p> : null}
        </div>
    );
}

function ExplorerOverlayControl({
    drift,
    overlayMode,
    runs,
    onOverlayModeChange,
}: {
    drift: DriftState | undefined;
    overlayMode: DashboardStructureExplorerOverlayMode;
    runs: DashboardStructureImportRun[];
    onOverlayModeChange: (mode: DashboardStructureExplorerOverlayMode) => void;
}) {
    return (
        <label className='flex min-w-0 items-center justify-between gap-3 border-b border-[var(--dash-border)] pb-3 text-xs font-medium text-[var(--dash-text-muted)]'>
            Review layer
            <select
                aria-label='Review layer'
                value={overlayMode}
                onChange={(event) =>
                    onOverlayModeChange(event.currentTarget.value as DashboardStructureExplorerOverlayMode)
                }
                className={`${dashboardCompactFieldClassName} max-w-[16rem] min-w-0 flex-1`}>
                <option value='none'>No review layer</option>
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
