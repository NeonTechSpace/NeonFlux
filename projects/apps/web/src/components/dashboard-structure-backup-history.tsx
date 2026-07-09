import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Download, Eye, GitCompareArrows, Pencil, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { useMemo, useRef } from 'react';

import type { DashboardStructureBackupSummary } from '../server/dashboard-structure.server.js';
import { buildDashboardStructureBackupRowId } from './dashboard-structure-backup-health.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatBackupSource, formatDate } from './dashboard-structure-panel-format.js';
import type { BackupPageState } from './dashboard-structure-panel-types.js';
import { IconButton, MiniCount } from './dashboard-structure-panel-shared.js';

export function DashboardStructureBackupHistory({
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
    busyAction: StructureBusyAction | undefined;
    onDownload: (backup: DashboardStructureBackupSummary) => void;
    onCheckDrift: (backup: DashboardStructureBackupSummary) => void;
    onInspect: (backup: DashboardStructureBackupSummary) => void;
    onImport: (backup: DashboardStructureBackupSummary) => void;
    onLoadMore: () => void;
    onRename: (backup: DashboardStructureBackupSummary) => void;
    onDelete: (backup: DashboardStructureBackupSummary) => void;
    editingBackupId: string | undefined;
    editingBackupName: string;
    deleteConfirmBackupId: string | undefined;
    onBeginRename: (backup: DashboardStructureBackupSummary) => void;
    onCancelRename: () => void;
    onRenameNameChange: (name: string) => void;
    onCancelDelete: () => void;
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const backups = page.backups;
    const hasLoadMoreRow = Boolean(page.nextCursor);
    const rowCount = backups.length + (hasLoadMoreRow ? 1 : 0);
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 118,
        initialRect: { height: 448, width: 800 },
        overscan: 5,
    });
    const virtualRows = virtualizer.getVirtualItems();
    const renderedRows =
        virtualRows.length > 0
            ? virtualRows
            : Array.from({ length: rowCount }, (_, index) => ({
                  index,
                  key: `backup-fallback-${index}`,
                  start: index * 118,
              }));
    const headerText = useMemo(
        () =>
            backups.length === 1
                ? '1 stored backup'
                : backups.length > 1
                  ? `${backups.length} stored backups`
                  : 'No stored backups',
        [backups.length]
    );

    return (
        <div className='rounded-md border border-neutral-800 bg-neutral-950/60'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2'>
                <div>
                    <p className='text-sm font-semibold text-white'>Backup library</p>
                    <p className='mt-0.5 text-xs text-neutral-500'>{headerText}</p>
                </div>
                {page.nextCursor ? (
                    <button
                        type='button'
                        onClick={onLoadMore}
                        disabled={Boolean(busyAction)}
                        className='min-h-9 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        {busyAction === 'backup-page' ? 'Loading' : 'Load more'}
                    </button>
                ) : null}
            </div>
            {backups.length === 0 ? (
                <p className='px-3 py-8 text-sm leading-6 text-neutral-400'>No server blueprint backups yet.</p>
            ) : (
                <div ref={parentRef} className='h-[28rem] overflow-y-auto overscroll-contain'>
                    <div
                        className='relative w-full'
                        style={{
                            height: `${Math.max(virtualizer.getTotalSize(), rowCount * 118)}px`,
                        }}>
                        {renderedRows.map((virtualRow) => {
                            const backup = backups[virtualRow.index] as DashboardStructureBackupSummary | undefined;

                            return (
                                <div
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    className='absolute top-0 left-0 w-full px-3 py-2'
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
                                            className='min-h-14 w-full rounded-md border border-dashed border-neutral-700 text-sm font-semibold text-neutral-300 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                            {busyAction === 'backup-page' ? 'Loading backups' : 'Load more backups'}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
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
    backup: DashboardStructureBackupSummary;
    busyAction: StructureBusyAction | undefined;
    isEditing: boolean;
    editingName: string;
    isDeleteConfirming: boolean;
    onBeginRename: (backup: DashboardStructureBackupSummary) => void;
    onCancelRename: () => void;
    onRenameNameChange: (name: string) => void;
    onRename: (backup: DashboardStructureBackupSummary) => void;
    onCheckDrift: (backup: DashboardStructureBackupSummary) => void;
    onInspect: (backup: DashboardStructureBackupSummary) => void;
    onImport: (backup: DashboardStructureBackupSummary) => void;
    onDownload: (backup: DashboardStructureBackupSummary) => void;
    onDelete: (backup: DashboardStructureBackupSummary) => void;
    onCancelDelete: () => void;
}) {
    const isSucceeded = backup.status === 'succeeded';
    const backupRowId = buildDashboardStructureBackupRowId(backup.id);
    const busy = Boolean(busyAction);
    const isDriftBusy = busyAction === `backup-drift:${backup.id}`;
    const isInspectBusy = busyAction === `backup-json:${backup.id}`;
    const isRenameBusy = busyAction === `backup-rename:${backup.id}`;
    const isImportBusy = busyAction === `backup-import:${backup.id}`;
    const isDownloadBusy = busyAction === `backup-json:${backup.id}`;
    const isDeleteBusy = busyAction === `backup-delete:${backup.id}`;
    const isRestorePoint = backup.source === 'restore_point';

    return (
        <div
            id={backupRowId}
            role='group'
            aria-label={`Backup ${backup.name}`}
            className='scroll-mt-24 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-3 shadow-sm'>
            <div className='grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.75fr)_auto] lg:items-center'>
                <div className='min-w-0'>
                    {isEditing ? (
                        <div className='flex min-w-0 gap-2'>
                            <input
                                value={editingName}
                                onChange={(event) => onRenameNameChange(event.currentTarget.value)}
                                maxLength={120}
                                className='h-9 min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                                aria-label='Backup name'
                            />
                            <IconButton
                                label='Save backup name'
                                disabled={busy}
                                onClick={() => onRename(backup)}
                                busy={isRenameBusy}>
                                <Check className='size-4' />
                            </IconButton>
                            <IconButton label='Cancel rename' disabled={busy} onClick={onCancelRename}>
                                <X className='size-4' />
                            </IconButton>
                        </div>
                    ) : (
                        <button
                            type='button'
                            onClick={() => onBeginRename(backup)}
                            className='group flex min-w-0 items-center gap-2 text-left'>
                            <span className='truncate text-sm font-semibold text-white group-hover:text-sky-200'>
                                {backup.name}
                            </span>
                            <Pencil className='size-3.5 shrink-0 text-neutral-500 group-hover:text-sky-300' />
                        </button>
                    )}
                    <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500'>
                        <span>{formatDate(backup.completedAt)}</span>
                        <span>{formatBackupSource(backup.source)}</span>
                        <span className={backup.status === 'failed' ? 'text-rose-300' : 'text-emerald-300'}>
                            {backup.status === 'failed' ? (backup.errorMessage ?? 'Failed') : 'Succeeded'}
                        </span>
                    </div>
                </div>
                <div className='grid grid-cols-3 gap-2 text-center'>
                    <MiniCount label='Roles' value={backup.roleCount} />
                    <MiniCount label='Categories' value={backup.categoryCount} />
                    <MiniCount label='Channels' value={backup.channelCount} />
                </div>
                <div className='flex justify-start gap-2 lg:justify-end'>
                    <IconButton
                        label='Check drift against this backup'
                        disabled={busy || !isSucceeded}
                        busy={isDriftBusy}
                        onClick={() => onCheckDrift(backup)}>
                        <GitCompareArrows className='size-4' />
                    </IconButton>
                    <IconButton
                        label='Inspect backup'
                        disabled={busy || !isSucceeded}
                        busy={isInspectBusy}
                        onClick={() => onInspect(backup)}>
                        <Eye className='size-4' />
                    </IconButton>
                    <IconButton
                        label={isRestorePoint ? 'Create restore dry-run' : 'Create dry-run from backup'}
                        disabled={busy || !isSucceeded}
                        busy={isImportBusy}
                        onClick={() => onImport(backup)}>
                        {isRestorePoint ? <RotateCcw className='size-4' /> : <Upload className='size-4' />}
                    </IconButton>
                    <IconButton
                        label='Download backup JSON'
                        disabled={busy || !isSucceeded}
                        busy={isDownloadBusy}
                        onClick={() => onDownload(backup)}>
                        <Download className='size-4' />
                    </IconButton>
                    {isDeleteConfirming ? (
                        <>
                            <IconButton
                                label='Confirm backup delete'
                                disabled={busy}
                                busy={isDeleteBusy}
                                tone='danger'
                                onClick={() => onDelete(backup)}>
                                <Trash2 className='size-4' />
                            </IconButton>
                            <IconButton label='Cancel delete' disabled={busy} onClick={onCancelDelete}>
                                <RotateCcw className='size-4' />
                            </IconButton>
                        </>
                    ) : (
                        <IconButton
                            label='Delete backup'
                            disabled={busy}
                            tone='danger'
                            onClick={() => onDelete(backup)}>
                            <Trash2 className='size-4' />
                        </IconButton>
                    )}
                </div>
            </div>
        </div>
    );
}
