// @vitest-environment jsdom
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardStructureBackupSummary } from '../server/dashboard-structure.server.js';
import { DashboardStructureBackupHistory } from './dashboard-structure-backup-history.js';

const backup: DashboardStructureBackupSummary = {
    id: 'backup-1',
    name: 'NeonSpace backup',
    source: 'manual',
    status: 'succeeded',
    createdAt: '2026-07-10T10:00:00.000Z',
    completedAt: '2026-07-10T10:00:05.000Z',
    roleCount: 3,
    categoryCount: 2,
    channelCount: 9,
};

afterEach(cleanup);

describe('DashboardStructureBackupHistory', () => {
    it('keeps routine backup actions accessible from one disclosure', () => {
        const view = renderHistory();

        expect(screen.getByLabelText('Actions for NeonSpace backup')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Check drift against this backup' }));
        fireEvent.click(screen.getByRole('button', { name: 'Inspect backup' }));
        fireEvent.click(screen.getByRole('button', { name: 'Use as deploy source' }));
        fireEvent.click(screen.getByRole('button', { name: 'Download backup JSON' }));
        fireEvent.click(screen.getByRole('button', { name: 'Rename backup' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete backup' }));

        expect(view.onCheckDrift).toHaveBeenCalledWith(backup);
        expect(view.onInspect).toHaveBeenCalledWith(backup);
        expect(view.onImport).toHaveBeenCalledWith(backup);
        expect(view.onDownload).toHaveBeenCalledWith(backup);
        expect(view.onBeginRename).toHaveBeenCalledWith(backup);
        expect(view.onDelete).toHaveBeenCalledWith(backup);
    });

    it('keeps inline rename controls accessible', () => {
        const view = renderHistory({ editingBackupId: backup.id, editingBackupName: 'Renamed backup' });

        fireEvent.change(screen.getByLabelText('Backup name'), { target: { value: 'Next name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save backup name' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel rename' }));

        expect(view.onRenameNameChange).toHaveBeenCalledWith('Next name');
        expect(view.onRename).toHaveBeenCalledWith(backup);
        expect(view.onCancelRename).toHaveBeenCalledOnce();
    });

    it('shows explicit delete confirmation actions', () => {
        const view = renderHistory({ deleteConfirmBackupId: backup.id });

        fireEvent.click(screen.getByRole('button', { name: 'Confirm backup delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));

        expect(view.onDelete).toHaveBeenCalledWith(backup);
        expect(view.onCancelDelete).toHaveBeenCalledOnce();
    });

    it('preserves paged loading and protects restore points from manual deletion', () => {
        const view = renderHistory({
            page: {
                backups: [{ ...backup, source: 'restore_point' }],
                nextCursor: 'cursor-2',
            },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

        expect(screen.getByRole('button', { name: 'Plan restore with Match' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Delete backup' })).toBeNull();
        expect(view.onLoadMore).toHaveBeenCalledOnce();
    });
});

function renderHistory(
    overrides: Partial<Parameters<typeof DashboardStructureBackupHistory>[0]> = {}
): ReturnType<typeof createHandlers> {
    const handlers = createHandlers();

    render(
        <DashboardStructureBackupHistory
            page={{ backups: [backup] }}
            busyAction={undefined}
            editingBackupId={undefined}
            editingBackupName=''
            deleteConfirmBackupId={undefined}
            {...handlers}
            {...overrides}
        />
    );

    return handlers;
}

function createHandlers() {
    return {
        onDownload: vi.fn(),
        onCheckDrift: vi.fn(),
        onInspect: vi.fn(),
        onImport: vi.fn(),
        onLoadMore: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onBeginRename: vi.fn(),
        onCancelRename: vi.fn(),
        onRenameNameChange: vi.fn(),
        onCancelDelete: vi.fn(),
    };
}
