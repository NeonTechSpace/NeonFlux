import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardStructureSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    applyDashboardStructureImportRunRouteData,
    confirmDashboardStructureImportRunRouteData,
    createDashboardStructureDryRunRouteData,
    exportDashboardStructureRouteData,
    preflightDashboardStructureImportRunRouteData,
    readDashboardStructureSettingsRouteData,
} from '../server/dashboard-structure-route-data.js';
import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type {
    DashboardStructureExportSummary,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import { DashboardStructureImportHistory } from './dashboard-structure-import-history.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';

type PanelStatus = {
    tone: 'success' | 'error' | 'neutral';
    message: string;
};

export function DashboardStructurePanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardStructureSettingsQueryKey(guildId);
    const [importJson, setImportJson] = useState('');
    const [exportedJson, setExportedJson] = useState('');
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyAction, setBusyAction] = useState<StructureBusyAction | undefined>();
    const [confirmationByRunId, setConfirmationByRunId] = useState<Record<string, string>>({});
    const [applyConfirmationByRunId, setApplyConfirmationByRunId] = useState<Record<string, string>>({});
    const [deleteConfirmationByRunId, setDeleteConfirmationByRunId] = useState<Record<string, string>>({});
    const [preflightByRunId, setPreflightByRunId] = useState<Record<string, DashboardStructurePreflightReport>>({});
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardStructureSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') throw new Error('Could not load structure tools.');

            return result;
        },
    });
    const latestRun = useMemo(() => settingsQuery.data?.importRuns.at(0), [settingsQuery.data?.importRuns]);

    async function refreshSettings(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey });
    }

    async function exportCurrentStructure(): Promise<void> {
        setStatus(undefined);
        setBusyAction('export');

        try {
            const result = await exportDashboardStructureRouteData({ data: { guildId } });

            if (result.type !== 'exported') {
                setStatus(toErrorStatus(result.type));
                return;
            }

            setExportedJson(result.snapshotJson);
            setStatus({
                tone: 'success',
                message: `Exported ${formatCounts(result.exportSnapshot)}.`,
            });
            await refreshSettings();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function confirmImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`confirm:${run.id}`);

        try {
            const result = await confirmDashboardStructureImportRunRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    confirmationText: confirmationByRunId[run.id] ?? '',
                },
            });

            if (result.type !== 'confirmed') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'confirmation-mismatch'
                          ? { tone: 'error', message: `Type ${result.expectedText} exactly to confirm.` }
                          : result.type === 'not-confirmable'
                            ? {
                                  tone: 'error',
                                  message: `This dry-run is ${formatStatus(result.status)} and cannot be confirmed.`,
                              }
                            : toErrorStatus(result.type)
                );
                return;
            }

            setConfirmationByRunId((current) => ({ ...current, [run.id]: '' }));
            setStatus({
                tone: 'success',
                message: 'Dry-run confirmed. No server changes were applied.',
            });
            await refreshSettings();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function preflightImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`preflight:${run.id}`);

        try {
            const result = await preflightDashboardStructureImportRunRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                },
            });

            if (result.type !== 'preflight') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'not-preflightable'
                          ? {
                                tone: 'error',
                                message: `This dry-run is ${formatStatus(result.status)} and cannot be preflighted.`,
                            }
                          : toErrorStatus(result.type)
                );
                return;
            }

            setPreflightByRunId((current) => ({ ...current, [run.id]: result.report }));
            setStatus({
                tone: 'neutral',
                message: `Preflight checked ${result.report.summary.total} planned changes. No server changes were applied.`,
            });
        } finally {
            setBusyAction(undefined);
        }
    }

    async function applyImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`apply:${run.id}`);

        try {
            const result = await applyDashboardStructureImportRunRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    confirmationText: applyConfirmationByRunId[run.id] ?? '',
                    ...(deleteConfirmationByRunId[run.id]
                        ? { destructiveConfirmationText: deleteConfirmationByRunId[run.id] }
                        : {}),
                },
            });

            if (result.type !== 'applied' && result.type !== 'failed') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'confirmation-mismatch'
                          ? { tone: 'error', message: `Type ${result.expectedText} exactly to apply.` }
                          : result.type === 'destructive-confirmation-mismatch'
                            ? { tone: 'error', message: `Type ${result.expectedText} exactly to approve deletes.` }
                            : result.type === 'not-applicable'
                              ? {
                                    tone: 'error',
                                    message: `This dry-run is ${formatStatus(result.status)} and cannot be applied.`,
                                }
                              : result.type === 'preflight-blocked'
                                ? {
                                      tone: 'error',
                                      message: `Apply blocked: ${result.report.summary.ready}/${result.report.summary.total} actions are ready.`,
                                  }
                                : toErrorStatus(result.type)
                );
                return;
            }

            setApplyConfirmationByRunId((current) => ({ ...current, [run.id]: '' }));
            setDeleteConfirmationByRunId((current) => ({ ...current, [run.id]: '' }));
            setStatus({
                tone: result.type === 'applied' ? 'success' : 'error',
                message:
                    result.type === 'applied'
                        ? `Applied ${result.importRun.actions.length} structure updates.`
                        : 'Structure apply finished with failures. Review action statuses before retrying.',
            });
            await refreshSettings();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function createDryRun(): Promise<void> {
        setStatus(undefined);
        setBusyAction('dry-run');

        try {
            const result = await createDashboardStructureDryRunRouteData({
                data: {
                    guildId,
                    snapshotJson: importJson,
                },
            });

            if (result.type !== 'dry-run-created') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setStatus({
                tone: 'success',
                message: `Dry-run created with ${result.importRun.actions.length} planned changes.`,
            });
            await refreshSettings();
        } finally {
            setBusyAction(undefined);
        }
    }

    if (settingsQuery.isPending) return <DashboardStructureLoading />;

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Import and export</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load structure tools.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Import and export</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Capture server structure, review dry-runs, and apply supported updates behind fresh preflight
                    checks.
                </p>
                {settingsQuery.data.observedState.observedChangeCount > 0 ? (
                    <p className='mt-2 text-sm leading-6 text-sky-200'>
                        {formatObservedState(settingsQuery.data.observedState)}
                    </p>
                ) : null}
            </div>

            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(22rem,32rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='structure-tools-heading'>
                    <h4 id='structure-tools-heading' className='text-sm font-semibold text-white'>
                        Structure tools
                    </h4>
                    <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
                        <div className='flex flex-wrap items-center justify-between gap-3'>
                            <div>
                                <p className='text-sm font-semibold text-white'>Export current structure</p>
                                <p className='mt-1 text-xs leading-5 text-neutral-400'>
                                    Reads roles, categories, channels, and permission overwrites.
                                </p>
                            </div>
                            <button
                                type='button'
                                onClick={() => void exportCurrentStructure()}
                                disabled={Boolean(busyAction)}
                                className='min-h-10 rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                                {busyAction === 'export' ? 'Exporting' : 'Export'}
                            </button>
                        </div>
                        {exportedJson ? (
                            <div className='mt-3 space-y-2'>
                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <p className='text-xs font-medium text-neutral-300'>Latest export JSON</p>
                                    <button
                                        type='button'
                                        onClick={() => setImportJson(exportedJson)}
                                        className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-200 transition hover:border-sky-400 hover:text-sky-200'>
                                        Use for dry-run
                                    </button>
                                </div>
                                <textarea
                                    value={exportedJson}
                                    readOnly
                                    rows={8}
                                    className='w-full resize-y rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-300 outline-none'
                                />
                            </div>
                        ) : null}
                    </div>

                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Import JSON dry-run</span>
                        <textarea
                            value={importJson}
                            onChange={(event) => setImportJson(event.currentTarget.value)}
                            rows={12}
                            spellCheck={false}
                            className='w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='Paste a NeonFlux structure export JSON payload.'
                        />
                    </label>
                    <button
                        type='button'
                        onClick={() => void createDryRun()}
                        disabled={Boolean(busyAction)}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        {busyAction === 'dry-run' ? 'Creating dry-run' : 'Create dry-run'}
                    </button>
                    {status ? <StatusMessage status={status} /> : null}
                    <p className='text-xs leading-5 text-neutral-500'>
                        Dry-runs are persisted for review. This page does not apply changes to the server.
                    </p>
                </section>

                <section className='space-y-5 p-4' aria-labelledby='structure-history-heading'>
                    <div>
                        <h4 id='structure-history-heading' className='text-sm font-semibold text-white'>
                            Recent structure history
                        </h4>
                        <p className='mt-1 text-xs leading-5 text-neutral-400'>
                            Exports and dry-runs are scoped to this server.
                        </p>
                    </div>
                    <ExportHistory exports={settingsQuery.data.exports} />
                    <DashboardStructureImportHistory
                        runs={settingsQuery.data.importRuns}
                        latestRun={latestRun}
                        busyAction={busyAction}
                        confirmationByRunId={confirmationByRunId}
                        preflightByRunId={preflightByRunId}
                        applyConfirmationByRunId={applyConfirmationByRunId}
                        deleteConfirmationByRunId={deleteConfirmationByRunId}
                        onConfirmationChange={(runId, confirmation) =>
                            setConfirmationByRunId((current) => ({ ...current, [runId]: confirmation }))
                        }
                        onApplyConfirmationChange={(runId, confirmation) =>
                            setApplyConfirmationByRunId((current) => ({ ...current, [runId]: confirmation }))
                        }
                        onDeleteConfirmationChange={(runId, confirmation) =>
                            setDeleteConfirmationByRunId((current) => ({ ...current, [runId]: confirmation }))
                        }
                        onConfirm={(run) => void confirmImportRun(run)}
                        onPreflight={(run) => void preflightImportRun(run)}
                        onApply={(run) => void applyImportRun(run)}
                    />
                </section>
            </div>
        </article>
    );
}

function ExportHistory({ exports }: { exports: DashboardStructureExportSummary[] }) {
    if (exports.length === 0) {
        return <p className='text-sm leading-6 text-neutral-400'>No structure exports yet.</p>;
    }

    return (
        <div className='overflow-x-auto'>
            <table className='w-full min-w-[36rem] text-left text-sm'>
                <thead className='text-xs text-neutral-500 uppercase'>
                    <tr>
                        <th className='py-2 pr-3 font-medium'>Exported</th>
                        <th className='py-2 pr-3 font-medium'>Source</th>
                        <th className='py-2 pr-3 font-medium'>Counts</th>
                    </tr>
                </thead>
                <tbody className='divide-y divide-neutral-800'>
                    {exports.map((snapshot) => (
                        <tr key={snapshot.id}>
                            <td className='py-3 pr-3 text-neutral-300'>{formatDate(snapshot.createdAt)}</td>
                            <td className='py-3 pr-3 text-neutral-400'>{snapshot.source}</td>
                            <td className='py-3 pr-3 text-neutral-400'>{formatCounts(snapshot)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function StatusMessage({ status }: { status: PanelStatus }) {
    const colorClass =
        status.tone === 'success' ? 'text-emerald-300' : status.tone === 'error' ? 'text-rose-300' : 'text-neutral-400';

    return <p className={`text-sm leading-6 ${colorClass}`}>{status.message}</p>;
}

function DashboardStructureLoading() {
    return (
        <article
            className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'
            aria-label='Loading structure tools'>
            <div className='h-5 w-44 animate-pulse rounded bg-neutral-800' />
            <div className='mt-3 h-4 w-64 animate-pulse rounded bg-neutral-800' />
            <div className='mt-5 h-32 animate-pulse rounded bg-neutral-950' />
        </article>
    );
}

function toErrorStatus(type: string): PanelStatus {
    const messages: Record<string, string> = {
        'auth-required': 'Sign in again before changing structure data.',
        'bot-token-missing': 'The web service needs FLUXER_BOT_TOKEN to read server structure.',
        'structure-read-failed': 'NeonFlux could not read this server structure.',
        'database-error': 'The dashboard database could not save the structure data.',
        'guild-lookup-failed': 'This server could not be loaded from Fluxer.',
        'deployment-config-not-found': 'Dashboard deployment config is missing.',
        'not-found': 'This server is not available for this account.',
    };

    return {
        tone: 'error',
        message: messages[type] ?? 'Structure operation failed.',
    };
}

function formatCounts(snapshot: Pick<DashboardStructureExportSummary, 'roleCount' | 'categoryCount' | 'channelCount'>) {
    return `${snapshot.roleCount} roles, ${snapshot.categoryCount} categories, ${snapshot.channelCount} channels`;
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

function formatStatus(status: string): string {
    return status.replaceAll('_', ' ');
}

function formatObservedState(state: { observedChangeCount: number; lastEventType?: string; lastObservedAt?: string }) {
    const event = state.lastEventType ? formatStatus(state.lastEventType) : 'structure change';
    const date = state.lastObservedAt ? formatDate(state.lastObservedAt) : undefined;

    return `${state.observedChangeCount} observed structure change${
        state.observedChangeCount === 1 ? '' : 's'
    } since tracking started. Last: ${event}${date ? ` at ${date}` : ''}.`;
}
