import { useState } from 'react';

import {
    downloadDashboardBlueprintExportRouteData,
    readDashboardBlueprintBackupJsonRouteData,
} from '../server/dashboard-blueprint-route-data.js';
import type { DashboardBlueprintPlanStep, DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import type {
    DashboardBlueprintExplorerComparisonTarget,
    DashboardBlueprintExplorerOverlayMode,
    DashboardBlueprintExplorerSource,
} from './dashboard-blueprint-explorer-types.js';
import { formatDashboardBlueprintExplorerSnapshotJson } from './dashboard-blueprint-explorer-json.js';
import {
    parseDashboardBlueprintExplorerSnapshot,
    readDashboardBlueprintExplorerEntityKey,
    readDashboardBlueprintExplorerSection,
} from './dashboard-blueprint-explorer-snapshot.js';
import type {
    DashboardBlueprintExplorerEntityKey,
    DashboardBlueprintExplorerSection,
} from './dashboard-blueprint-explorer-model.js';
import { formatBackupSource, formatDate } from './dashboard-blueprint-panel-format.js';
import { readRequestedFinalStateExplorerSnapshot } from './dashboard-blueprint-panel-requested-snapshot.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';
import { emptyExplorerComparisonTarget } from './dashboard-blueprint-panel-types.js';
import type { DriftState, PanelStatus } from './dashboard-blueprint-panel-types.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';

export function useDashboardBlueprintExplorerState({
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
    initialSource?: DashboardBlueprintExplorerSource;
    onSourceChange?: (source: DashboardBlueprintExplorerSource) => void;
    setBusyAction: (action: BlueprintBusyAction | undefined) => void;
    setStatus: (status: PanelStatus | undefined) => void;
}) {
    const [explorerSource, setExplorerSource] = useState<DashboardBlueprintExplorerSource>(
        initialSource ?? { label: 'No snapshot', type: 'none' }
    );
    const [explorerComparisonTarget, setExplorerComparisonTarget] =
        useState<DashboardBlueprintExplorerComparisonTarget>(emptyExplorerComparisonTarget);
    const [explorerOverlayMode, setExplorerOverlayMode] = useState<DashboardBlueprintExplorerOverlayMode>('none');
    const [explorerSection, setExplorerSection] = useState<DashboardBlueprintExplorerSection>('channels');
    const [selectedExplorerEntityKeys, setSelectedExplorerEntityKeys] = useState<
        Partial<Record<DashboardBlueprintExplorerSection, DashboardBlueprintExplorerEntityKey>>
    >({});
    const selectedExplorerEntityKey = selectedExplorerEntityKeys[explorerSection];

    function setSelectedExplorerEntityKey(entityKey: DashboardBlueprintExplorerEntityKey | undefined): void {
        if (!entityKey) {
            setSelectedExplorerEntityKeys({});
            return;
        }

        const section = readDashboardBlueprintExplorerSection(entityKey);
        setSelectedExplorerEntityKeys((current) => ({ ...current, [section]: entityKey }));
    }

    function revealExplorerEntity(entityKey: DashboardBlueprintExplorerEntityKey | undefined): void {
        if (!entityKey) {
            setSelectedExplorerEntityKeys({});
            return;
        }

        const section = readDashboardBlueprintExplorerSection(entityKey);
        setExplorerSection(section);
        setSelectedExplorerEntityKeys((current) => ({ ...current, [section]: entityKey }));
    }

    function setExplorerSourceAndResetComparison(source: DashboardBlueprintExplorerSource): void {
        setExplorerSource(source);
        onSourceChange?.(source);
        setExplorerComparisonTarget(emptyExplorerComparisonTarget);
    }

    async function loadLiveExplorerSnapshot(): Promise<void> {
        setStatus(undefined);
        setBusyAction('explorer-live');

        try {
            const result = await downloadDashboardBlueprintExportRouteData({ data: { guildId } });

            if (result.type !== 'structure-export-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            const snapshot = parseDashboardBlueprintExplorerSnapshot(result.structureJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Live server blueprint could not be parsed for the explorer.' });
                return;
            }

            setExplorerSourceAndResetComparison({
                canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
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

        const snapshot = parseDashboardBlueprintExplorerSnapshot(importJson);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'Import JSON could not be parsed as a server blueprint.' });
            return false;
        }

        setExplorerSourceAndResetComparison({
            canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
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

        const snapshot = parseDashboardBlueprintExplorerSnapshot(importJson);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'Import JSON could not be parsed as a server blueprint.' });
            return;
        }

        setExplorerComparisonTarget({
            canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
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
            const result = await downloadDashboardBlueprintExportRouteData({ data: { guildId } });

            if (result.type !== 'structure-export-created') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            const snapshot = parseDashboardBlueprintExplorerSnapshot(result.structureJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Live server blueprint could not be parsed for the explorer.' });
                return;
            }

            setExplorerComparisonTarget({
                canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
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
            const result = await readDashboardBlueprintBackupJsonRouteData({
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

            const snapshot = parseDashboardBlueprintExplorerSnapshot(result.backupJson);
            if (!snapshot) {
                setStatus({ tone: 'error', message: 'Backup JSON could not be parsed for the explorer.' });
                return;
            }

            setExplorerComparisonTarget({
                canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
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

    function inspectRequestedFinalState(run: DashboardBlueprintPlan): void {
        setStatus(undefined);
        const snapshot = readRequestedFinalStateExplorerSnapshot(run);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'This plan does not include a requested final-state snapshot.' });
            return;
        }

        setExplorerSourceAndResetComparison({
            canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
            detail: `Plan ${formatDate(run.createdAt)}`,
            label: 'Requested final state',
            snapshot,
            type: 'requested-final-state',
        });
        setSelectedExplorerEntityKey(undefined);
        setStatus({
            tone: 'neutral',
            message: 'Requested final state loaded. This is the reviewed plan target, not the current server state.',
        });
    }

    function compareExplorerRequestedFinalState(run: DashboardBlueprintPlan): void {
        setStatus(undefined);
        const snapshot = readRequestedFinalStateExplorerSnapshot(run);
        if (!snapshot) {
            setStatus({ tone: 'error', message: 'This plan does not include a requested final-state snapshot.' });
            return;
        }

        setExplorerComparisonTarget({
            canonicalJson: formatDashboardBlueprintExplorerSnapshotJson(snapshot),
            detail: `Plan ${formatDate(run.createdAt)}`,
            label: 'Requested final state',
            snapshot,
            type: 'requested-final-state',
        });
        setStatus({
            tone: 'neutral',
            message: 'Requested final-state comparison loaded. This is the reviewed plan target, not applied state.',
        });
    }

    function selectDriftAction(action: DriftState['previewActions'][number]): void {
        setExplorerOverlayMode('drift');
        revealExplorerEntity(readDashboardBlueprintExplorerEntityKey(action));
    }

    function selectPlanStep(plan: DashboardBlueprintPlan, step: DashboardBlueprintPlanStep): void {
        setExplorerOverlayMode(`plan:${plan.id}`);
        revealExplorerEntity(readDashboardBlueprintExplorerEntityKey(step));
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
        selectPlanStep,
        selectedExplorerEntityKey,
        setExplorerOverlayMode,
        setExplorerSection,
        setExplorerSourceAndResetComparison,
        setSelectedExplorerEntityKey,
    };
}

export type DashboardBlueprintExplorerPanelState = ReturnType<typeof useDashboardBlueprintExplorerState>;
