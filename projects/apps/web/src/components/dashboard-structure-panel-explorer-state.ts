import { useState } from 'react';

import {
    downloadDashboardStructureExportRouteData,
    readDashboardStructureBackupJsonRouteData,
} from '../server/dashboard-structure-route-data.js';
import type {
    DashboardStructureImportAction,
    DashboardStructureImportRun,
} from '../server/dashboard-structure-model.js';
import type {
    DashboardStructureExplorerComparisonTarget,
    DashboardStructureExplorerOverlayMode,
    DashboardStructureExplorerSource,
} from './dashboard-structure-explorer-types.js';
import { formatDashboardStructureExplorerSnapshotJson } from './dashboard-structure-explorer-json.js';
import {
    parseDashboardStructureExplorerSnapshot,
    readDashboardStructureExplorerEntityKey,
    readDashboardStructureExplorerSection,
} from './dashboard-structure-explorer-snapshot.js';
import type {
    DashboardStructureExplorerEntityKey,
    DashboardStructureExplorerSection,
} from './dashboard-structure-explorer-model.js';
import { formatBackupSource, formatDate } from './dashboard-structure-panel-format.js';
import { readRequestedFinalStateExplorerSnapshot } from './dashboard-structure-panel-requested-snapshot.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-structure-panel-status.js';
import { emptyExplorerComparisonTarget } from './dashboard-structure-panel-types.js';
import type { DriftState, PanelStatus } from './dashboard-structure-panel-types.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';

export function useDashboardStructureExplorerState({
    driftState,
    guildId,
    importJson,
    initialSource,
    onSourceChange,
    setBusyAction,
    setStatus,
}: {
    driftState: DriftState | undefined;
    guildId: string;
    importJson: string;
    initialSource?: DashboardStructureExplorerSource;
    onSourceChange?: (source: DashboardStructureExplorerSource) => void;
    setBusyAction: (action: StructureBusyAction | undefined) => void;
    setStatus: (status: PanelStatus | undefined) => void;
}) {
    const [explorerSource, setExplorerSource] = useState<DashboardStructureExplorerSource>(
        initialSource ?? { label: 'No snapshot', type: 'none' }
    );
    const [explorerComparisonTarget, setExplorerComparisonTarget] =
        useState<DashboardStructureExplorerComparisonTarget>(emptyExplorerComparisonTarget);
    const [explorerOverlayMode, setExplorerOverlayMode] = useState<DashboardStructureExplorerOverlayMode>('none');
    const [explorerSection, setExplorerSection] = useState<DashboardStructureExplorerSection>('channels');
    const [selectedExplorerEntityKeys, setSelectedExplorerEntityKeys] = useState<
        Partial<Record<DashboardStructureExplorerSection, DashboardStructureExplorerEntityKey>>
    >({});
    const selectedExplorerEntityKey = selectedExplorerEntityKeys[explorerSection];

    function setSelectedExplorerEntityKey(entityKey: DashboardStructureExplorerEntityKey | undefined): void {
        if (!entityKey) {
            setSelectedExplorerEntityKeys({});
            return;
        }

        const section = readDashboardStructureExplorerSection(entityKey);
        setSelectedExplorerEntityKeys((current) => ({ ...current, [section]: entityKey }));
    }

    function revealExplorerEntity(entityKey: DashboardStructureExplorerEntityKey | undefined): void {
        if (!entityKey) {
            setSelectedExplorerEntityKeys({});
            return;
        }

        const section = readDashboardStructureExplorerSection(entityKey);
        setExplorerSection(section);
        setSelectedExplorerEntityKeys((current) => ({ ...current, [section]: entityKey }));
    }

    function setExplorerSourceAndResetComparison(source: DashboardStructureExplorerSource): void {
        setExplorerSource(source);
        onSourceChange?.(source);
        setExplorerComparisonTarget(emptyExplorerComparisonTarget);
    }

    async function loadLiveExplorerSnapshot(): Promise<void> {
        setStatus(undefined);
        setBusyAction('explorer-live');

        try {
            const result = await downloadDashboardStructureExportRouteData({ data: { guildId } });

            if (result.type !== 'structure-export-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            const snapshot = parseDashboardStructureExplorerSnapshot(result.structureJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Live server blueprint could not be parsed for the explorer.' });
                return;
            }

            setExplorerSourceAndResetComparison({
                canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
                label: 'Live server layout',
                snapshot,
                type: 'live',
                ...(snapshot.exportedAt ? { detail: `Read ${formatDate(snapshot.exportedAt)}` } : {}),
            });
            setSelectedExplorerEntityKey(undefined);
            setStatus({ tone: 'success', message: 'Live server blueprint loaded in explorer.' });
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    function inspectImportJson(): boolean {
        setStatus(undefined);

        const snapshot = parseDashboardStructureExplorerSnapshot(importJson);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'Import JSON could not be parsed as a server blueprint.' });
            return false;
        }

        setExplorerSourceAndResetComparison({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
            label: 'Import JSON',
            snapshot,
            type: 'import-json',
            ...(snapshot.exportedAt ? { detail: `Exported ${formatDate(snapshot.exportedAt)}` } : {}),
        });
        setSelectedExplorerEntityKey(undefined);
        setStatus({ tone: 'neutral', message: 'Import JSON loaded in explorer.' });
        return true;
    }

    function compareExplorerImportJson(): void {
        setStatus(undefined);

        const snapshot = parseDashboardStructureExplorerSnapshot(importJson);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'Import JSON could not be parsed as a server blueprint.' });
            return;
        }

        setExplorerComparisonTarget({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
            label: 'Import JSON',
            snapshot,
            type: 'import-json',
            ...(snapshot.exportedAt ? { detail: `Exported ${formatDate(snapshot.exportedAt)}` } : {}),
        });
        setStatus({ tone: 'neutral', message: 'Import JSON comparison loaded.' });
    }

    async function compareExplorerLive(): Promise<void> {
        setStatus(undefined);
        setBusyAction('explorer-compare-live');

        try {
            const result = await downloadDashboardStructureExportRouteData({ data: { guildId } });

            if (result.type !== 'structure-export-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            const snapshot = parseDashboardStructureExplorerSnapshot(result.structureJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Live server blueprint could not be parsed for the explorer.' });
                return;
            }

            setExplorerComparisonTarget({
                canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
                label: 'Live server layout',
                snapshot,
                type: 'live',
                ...(snapshot.exportedAt ? { detail: `Read ${formatDate(snapshot.exportedAt)}` } : {}),
            });
            setStatus({ tone: 'neutral', message: 'Live server blueprint comparison loaded.' });
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function compareExplorerDriftBaseline(): Promise<void> {
        const baseline = driftState?.baseline;
        if (!baseline || baseline.status !== 'succeeded') return;

        setStatus(undefined);
        setBusyAction('explorer-compare-baseline');

        try {
            const result = await readDashboardStructureBackupJsonRouteData({
                data: { backupId: baseline.id, guildId },
            });

            if (result.type !== 'backup-json') {
                setStatus(
                    result.type === 'backup-json-unavailable'
                        ? { tone: 'error', message: 'This backup does not have server blueprint JSON.' }
                        : toErrorStatus(result.type)
                );
                return;
            }

            const snapshot = parseDashboardStructureExplorerSnapshot(result.backupJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Backup JSON could not be parsed for the explorer.' });
                return;
            }

            setExplorerComparisonTarget({
                canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
                detail: `${formatBackupSource(baseline.source)} · ${formatDate(baseline.completedAt)}`,
                label: baseline.name,
                snapshot,
                type: 'backup',
            });
            setStatus({ tone: 'neutral', message: 'Drift baseline comparison loaded.' });
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    function inspectRequestedFinalState(run: DashboardStructureImportRun): void {
        setStatus(undefined);
        const snapshot = readRequestedFinalStateExplorerSnapshot(run);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'This dry-run does not include a requested final-state snapshot.' });
            return;
        }

        setExplorerSourceAndResetComparison({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
            detail: `Dry-run ${formatDate(run.createdAt)}`,
            label: 'Requested final state',
            snapshot,
            type: 'requested-final-state',
        });
        setSelectedExplorerEntityKey(undefined);
        setStatus({
            tone: 'neutral',
            message: 'Requested final state loaded. This is the dry-run target, not the current server state.',
        });
    }

    function compareExplorerRequestedFinalState(run: DashboardStructureImportRun): void {
        setStatus(undefined);
        const snapshot = readRequestedFinalStateExplorerSnapshot(run);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'This dry-run does not include a requested final-state snapshot.' });
            return;
        }

        setExplorerComparisonTarget({
            canonicalJson: formatDashboardStructureExplorerSnapshotJson(snapshot),
            detail: `Dry-run ${formatDate(run.createdAt)}`,
            label: 'Requested final state',
            snapshot,
            type: 'requested-final-state',
        });
        setStatus({
            tone: 'neutral',
            message: 'Requested final-state comparison loaded. This is the dry-run target, not applied state.',
        });
    }

    function selectDriftAction(action: DriftState['previewActions'][number]): void {
        setExplorerOverlayMode('drift');
        revealExplorerEntity(readDashboardStructureExplorerEntityKey(action));
    }

    function selectImportAction(_run: DashboardStructureImportRun, action: DashboardStructureImportAction): void {
        setExplorerOverlayMode(`run:${_run.id}`);
        revealExplorerEntity(readDashboardStructureExplorerEntityKey(action));
    }

    return {
        compareExplorerDriftBaseline,
        compareExplorerImportJson,
        compareExplorerLive,
        compareExplorerRequestedFinalState,
        explorerComparisonTarget,
        explorerOverlayMode,
        explorerSection,
        explorerSource,
        inspectImportJson,
        inspectRequestedFinalState,
        loadLiveExplorerSnapshot,
        selectDriftAction,
        selectImportAction,
        selectedExplorerEntityKey,
        setExplorerOverlayMode,
        setExplorerSection,
        setExplorerSourceAndResetComparison,
        setSelectedExplorerEntityKey,
    };
}

export type DashboardStructureExplorerPanelState = ReturnType<typeof useDashboardStructureExplorerState>;
