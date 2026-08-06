import { useVirtualizer } from '@tanstack/react-virtual';
import {
    Check,
    Download,
    Eye,
    GitCompareArrows,
    Loader2,
    MoreHorizontal,
    Pencil,
    RotateCcw,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { useMemo, useRef } from 'react';

import type { DashboardBlueprintBackupSummary } from '../server/dashboard-blueprint-model.js';
import { buildDashboardBlueprintBackupRowId } from './dashboard-blueprint-backup-health.js';
import type { BlueprintBusyAction, BackupPageState } from './dashboard-blueprint-panel-types.js';
import { formatBackupSource, formatDate } from './dashboard-blueprint-panel-format.js';
import {
    dashboardCompactFieldClassName,
    dashboardDangerActionClassName,
    dashboardIconActionClassName,
    dashboardQuietActionClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';
import { getDashboardVirtualOverscan } from './dashboard-virtualization.js';

const backupViewportHeight = 448;
const estimatedBackupRowHeight = 76;

export function DashboardBlueprintBackupHistory({
    page,
    busyAction,
    onDownload,
    onCheckDrift,
    onInspect,
    onImport,
    onLoadMore,
    onRename,
    onDelete,
    editingBackupId,
    editingBackupName,
    deleteConfirmBackupId,
    onBeginRename,
    onCancelRename,
    onRenameNameChange,
    onCancelDelete,
}: {
    page: BackupPageState;
    busyAction: BlueprintBusyAction | undefined;
    onDownload: (backup: DashboardBlueprintBackupSummary) => void;
    onCheckDrift: (backup: DashboardBlueprintBackupSummary) => void;
    onInspect: (backup: DashboardBlueprintBackupSummary) => void;
    onImport: (backup: DashboardBlueprintBackupSummary) => void;
    onLoadMore: () => void;
    onRename: (backup: DashboardBlueprintBackupSummary) => void;
    onDelete: (backup: DashboardBlueprintBackupSummary) => void;
    editingBackupId: string | undefined;
    editingBackupName: string;
    deleteConfirmBackupId: string | undefined;
    onBeginRename: (backup: DashboardBlueprintBackupSummary) => void;
    onCancelRename: () => void;
    onRenameNameChange: (name: string) => void;
    onCancelDelete: () => void;
}) {
    'use no memo';

    const parentRef = useRef<HTMLDivElement>(null);
    const backups = page.backups;
    const hasLoadMoreRow = Boolean(page.nextCursor);
    const rowCount = backups.length + (hasLoadMoreRow ? 1 : 0);
    // TanStack Virtual owns mutable measurement callbacks, so this component intentionally opts out of compilation.
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimatedBackupRowHeight,
        initialRect: { height: backupViewportHeight, width: 800 },
        overscan: getDashboardVirtualOverscan({
            viewportSize: backupViewportHeight,
            itemSize: estimatedBackupRowHeight,
        }),
    });
    const virtualRows = virtualizer.getVirtualItems();
    const renderedRows =
        virtualRows.length > 0
            ? virtualRows
            : Array.from({ length: rowCount }, (_, index) => ({
                  index,
                  key: `backup-fallback-${index}`,
                  start: index * estimatedBackupRowHeight,
              }));
    const headerText = useMemo(
        () =>
            backups.length === 1
                ? '1 stored backup'
                : backups.length > 1
                  ? `${backups.length} stored backups`
                  : 'Saved backups for comparison and recovery',
        [backups.length]
    );

    return (
        <section
            className='border-y border-[var(--dash-border)] bg-[var(--dash-surface-muted)]'
            aria-label='Backup library'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-[var(--dash-border)] px-3 py-3'>
                <div>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>Backup library</p>
                    <p className='mt-0.5 text-xs text-[var(--dash-text-subtle)]'>{headerText}</p>
                </div>
                {page.nextCursor ? (
                    <button
                        type='button'
                        onClick={onLoadMore}
                        disabled={Boolean(busyAction)}
                        className={`${dashboardSecondaryActionClassName} text-xs`}>
                        {busyAction === 'backup-page' ? 'Loading' : 'Load more'}
                    </button>
                ) : null}
            </div>
            {backups.length === 0 ? (
                <p className='px-3 py-8 text-sm leading-6 text-[var(--dash-text-muted)]'>
                    Create a backup to establish the first comparison baseline and recovery source.
                </p>
            ) : (
                <div
                    ref={parentRef}
                    className='h-[min(28rem,55dvh)] min-h-72 overflow-y-auto overscroll-contain sm:h-[28rem]'
                    role='list'>
                    <div
                        className='relative w-full'
                        style={{
                            height: `${Math.max(virtualizer.getTotalSize(), rowCount * estimatedBackupRowHeight)}px`,
                        }}>
                        {renderedRows.map((virtualRow) => {
                            const backup = backups[virtualRow.index] as DashboardBlueprintBackupSummary | undefined;

                            return (
                                <div
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    className='absolute top-0 left-0 w-full border-b border-[var(--dash-border)] px-3'
                                    style={{
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}>
                                    {backup ? (
                                        <BackupLibraryRow
                                            backup={backup}
                                            busyAction={busyAction}
                                            isEditing={editingBackupId === backup.id}
                                            editingName={editingBackupName}
                                            isDeleteConfirming={deleteConfirmBackupId === backup.id}
                                            onBeginRename={onBeginRename}
                                            onCancelRename={onCancelRename}
                                            onRenameNameChange={onRenameNameChange}
                                            onRename={onRename}
                                            onCheckDrift={onCheckDrift}
                                            onInspect={onInspect}
                                            onImport={onImport}
                                            onDownload={onDownload}
                                            onDelete={onDelete}
                                            onCancelDelete={onCancelDelete}
                                        />
                                    ) : (
                                        <button
                                            type='button'
                                            onClick={onLoadMore}
                                            disabled={Boolean(busyAction)}
                                            className={`${dashboardQuietActionClassName} min-h-14 w-full text-sm`}>
                                            {busyAction === 'backup-page'
                                                ? 'Loading older backups'
                                                : 'Load older backups'}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </section>
    );
}

function BackupLibraryRow({
    backup,
    busyAction,
    isEditing,
    editingName,
    isDeleteConfirming,
    onBeginRename,
    onCancelRename,
    onRenameNameChange,
    onRename,
    onCheckDrift,
    onInspect,
    onImport,
    onDownload,
    onDelete,
    onCancelDelete,
}: {
    backup: DashboardBlueprintBackupSummary;
    busyAction: BlueprintBusyAction | undefined;
    isEditing: boolean;
    editingName: string;
    isDeleteConfirming: boolean;
    onBeginRename: (backup: DashboardBlueprintBackupSummary) => void;
    onCancelRename: () => void;
    onRenameNameChange: (name: string) => void;
    onRename: (backup: DashboardBlueprintBackupSummary) => void;
    onCheckDrift: (backup: DashboardBlueprintBackupSummary) => void;
    onInspect: (backup: DashboardBlueprintBackupSummary) => void;
    onImport: (backup: DashboardBlueprintBackupSummary) => void;
    onDownload: (backup: DashboardBlueprintBackupSummary) => void;
    onDelete: (backup: DashboardBlueprintBackupSummary) => void;
    onCancelDelete: () => void;
}) {
    const isSucceeded = backup.status === 'succeeded';
    const backupRowId = buildDashboardBlueprintBackupRowId(backup.id);
    const busy = Boolean(busyAction);
    const isDriftBusy = busyAction === `backup-drift:${backup.id}`;
    const isInspectBusy = busyAction === `backup-json:${backup.id}`;
    const isRenameBusy = busyAction === `backup-rename:${backup.id}`;
    const isImportBusy = busyAction === `backup-import:${backup.id}`;
    const isDownloadBusy = busyAction === `backup-json:${backup.id}`;
    const isDeleteBusy = busyAction === `backup-delete:${backup.id}`;
    const isRestorePoint = backup.source === 'restore_point';
    const contentSummary = `${backup.roleCount} roles · ${backup.categoryCount} categories · ${backup.channelCount} channels`;

    return (
        <div id={backupRowId} role='group' aria-label={`Backup ${backup.name}`} className='scroll-mt-24 py-2.5'>
            <div className='grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3'>
                <div className='min-w-0'>
                    {isEditing ? (
                        <div className='flex min-w-0 flex-wrap gap-2'>
                            <input
                                value={editingName}
                                onChange={(event) => onRenameNameChange(event.currentTarget.value)}
                                maxLength={120}
                                className={`${dashboardCompactFieldClassName} min-w-0 flex-1`}
                                aria-label='Backup name'
                            />
                            <button
                                type='button'
                                aria-label='Save backup name'
                                disabled={busy}
                                onClick={() => onRename(backup)}
                                className={`${dashboardSecondaryActionClassName} inline-flex items-center gap-2 text-xs`}>
                                {isRenameBusy ? (
                                    <Loader2 data-dashboard-loading='spinner' className='size-3.5 animate-spin' />
                                ) : (
                                    <Check className='size-3.5' />
                                )}
                                Save
                            </button>
                            <button
                                type='button'
                                aria-label='Cancel rename'
                                disabled={busy}
                                onClick={onCancelRename}
                                className={`${dashboardQuietActionClassName} inline-flex items-center gap-2 text-xs`}>
                                <X className='size-4' />
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <p className='truncate text-sm font-semibold text-[var(--dash-text)]'>{backup.name}</p>
                    )}
                    <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--dash-text-subtle)]'>
                        <span>{formatDate(backup.completedAt)}</span>
                        <span aria-hidden='true'>·</span>
                        <span>{formatBackupSource(backup.source)}</span>
                        <span aria-hidden='true'>·</span>
                        <span>{contentSummary}</span>
                    </div>
                    {backup.status === 'failed' ? (
                        <p className='mt-1 text-xs leading-5 text-[var(--dash-danger)]'>
                            {backup.errorMessage ?? 'Backup failed.'}
                        </p>
                    ) : null}
                </div>
                <BackupActions
                    backup={backup}
                    busy={busy}
                    isDeleteConfirming={isDeleteConfirming}
                    isDeleteBusy={isDeleteBusy}
                    isDownloadBusy={isDownloadBusy}
                    isDriftBusy={isDriftBusy}
                    isImportBusy={isImportBusy}
                    isInspectBusy={isInspectBusy}
                    isRestorePoint={isRestorePoint}
                    isSucceeded={isSucceeded}
                    onBeginRename={onBeginRename}
                    onCancelDelete={onCancelDelete}
                    onCheckDrift={onCheckDrift}
                    onDelete={onDelete}
                    onDownload={onDownload}
                    onImport={onImport}
                    onInspect={onInspect}
                />
            </div>
        </div>
    );
}

function BackupActions({
    backup,
    busy,
    isDeleteConfirming,
    isDeleteBusy,
    isDownloadBusy,
    isDriftBusy,
    isImportBusy,
    isInspectBusy,
    isRestorePoint,
    isSucceeded,
    onBeginRename,
    onCancelDelete,
    onCheckDrift,
    onDelete,
    onDownload,
    onImport,
    onInspect,
}: {
    backup: DashboardBlueprintBackupSummary;
    busy: boolean;
    isDeleteConfirming: boolean;
    isDeleteBusy: boolean;
    isDownloadBusy: boolean;
    isDriftBusy: boolean;
    isImportBusy: boolean;
    isInspectBusy: boolean;
    isRestorePoint: boolean;
    isSucceeded: boolean;
    onBeginRename: (backup: DashboardBlueprintBackupSummary) => void;
    onCancelDelete: () => void;
    onCheckDrift: (backup: DashboardBlueprintBackupSummary) => void;
    onDelete: (backup: DashboardBlueprintBackupSummary) => void;
    onDownload: (backup: DashboardBlueprintBackupSummary) => void;
    onImport: (backup: DashboardBlueprintBackupSummary) => void;
    onInspect: (backup: DashboardBlueprintBackupSummary) => void;
}) {
    return (
        <details className='group relative justify-self-end'>
            <summary
                data-dashboard-disclosure
                aria-label={`Actions for ${backup.name}`}
                className={`${dashboardIconActionClassName} size-9 cursor-pointer list-none marker:content-none [&::-webkit-details-marker]:hidden`}>
                <MoreHorizontal className='size-4' />
            </summary>
            <div className='mt-2 grid min-w-56 gap-0.5 rounded-[var(--dash-radius-control)] border border-[var(--dash-border-strong)] bg-[var(--dash-surface-raised)] p-1.5 shadow-[var(--dash-shadow-surface)]'>
                <BackupAction
                    icon={GitCompareArrows}
                    label='Check drift against this backup'
                    disabled={busy || !isSucceeded}
                    busy={isDriftBusy}
                    onClick={() => onCheckDrift(backup)}
                />
                <BackupAction
                    icon={Eye}
                    label='Inspect backup'
                    disabled={busy || !isSucceeded}
                    busy={isInspectBusy}
                    onClick={() => onInspect(backup)}
                />
                <BackupAction
                    icon={isRestorePoint ? RotateCcw : Upload}
                    label={isRestorePoint ? 'Plan restore with Match' : 'Use as deploy source'}
                    disabled={busy || !isSucceeded}
                    busy={isImportBusy}
                    onClick={() => onImport(backup)}
                />
                <BackupAction
                    icon={Download}
                    label='Download backup JSON'
                    disabled={busy || !isSucceeded}
                    busy={isDownloadBusy}
                    onClick={() => onDownload(backup)}
                />
                <BackupAction
                    icon={Pencil}
                    label='Rename backup'
                    disabled={busy}
                    onClick={(button) => {
                        closeActions(button);
                        onBeginRename(backup);
                    }}
                />
                <div className='my-1 border-t border-[var(--dash-border)]' />
                {isDeleteConfirming ? (
                    <div className='space-y-2 px-2 py-1.5'>
                        <p className='text-xs leading-5 text-[var(--dash-danger)]'>Delete this backup permanently?</p>
                        <div className='flex gap-2'>
                            <button
                                type='button'
                                aria-label='Confirm backup delete'
                                disabled={busy}
                                onClick={() => onDelete(backup)}
                                className={`${dashboardDangerActionClassName} inline-flex min-h-8 flex-1 items-center justify-center gap-2 px-2 text-xs`}>
                                {isDeleteBusy ? (
                                    <Loader2 data-dashboard-loading='spinner' className='size-3.5 animate-spin' />
                                ) : (
                                    <Trash2 className='size-3.5' />
                                )}
                                Delete
                            </button>
                            <button
                                type='button'
                                aria-label='Cancel delete'
                                disabled={busy}
                                onClick={(event) => {
                                    closeActions(event.currentTarget);
                                    onCancelDelete();
                                }}
                                className={`${dashboardQuietActionClassName} min-h-8 px-2 text-xs`}>
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <BackupAction
                        icon={Trash2}
                        label={isRestorePoint ? 'Delete restore point' : 'Delete backup'}
                        disabled={busy}
                        tone='danger'
                        onClick={() => onDelete(backup)}
                    />
                )}
            </div>
        </details>
    );
}

function BackupAction({
    icon: Icon,
    label,
    disabled,
    busy = false,
    tone = 'neutral',
    onClick,
}: {
    icon: typeof Eye;
    label: string;
    disabled: boolean;
    busy?: boolean;
    tone?: 'danger' | 'neutral';
    onClick: (button: HTMLButtonElement) => void;
}) {
    return (
        <button
            type='button'
            aria-label={label}
            aria-busy={busy || undefined}
            disabled={disabled}
            onClick={(event) => onClick(event.currentTarget)}
            className={`${tone === 'danger' ? dashboardDangerActionClassName : dashboardQuietActionClassName} flex w-full items-center gap-2 px-2 text-left text-xs`}>
            {busy ? (
                <Loader2 data-dashboard-loading='spinner' className='size-3.5 shrink-0 animate-spin' />
            ) : (
                <Icon className='size-3.5 shrink-0' />
            )}
            <span>{label}</span>
        </button>
    );
}

function closeActions(button: HTMLButtonElement): void {
    button.closest('details')?.removeAttribute('open');
}
