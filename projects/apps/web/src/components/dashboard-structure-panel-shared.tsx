import { RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import type { PanelStatus } from './dashboard-structure-panel-types.js';
import {
    dashboardDangerActionClassName,
    dashboardIconActionClassName,
    dashboardSecondaryActionClassName,
    DashboardStatus,
    DashboardSurface,
} from './dashboard-ui.js';

export function MiniCount({ label, value }: { label: string; value: number }) {
    return (
        <div className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-2 py-1.5'>
            <p className='text-xs font-semibold text-[var(--dash-text)]'>{value}</p>
            <p className='mt-0.5 text-[0.68rem] text-[var(--dash-text-subtle)] uppercase'>{label}</p>
        </div>
    );
}

export function IconButton({
    label,
    disabled,
    busy,
    tone = 'neutral',
    onClick,
    children,
}: {
    label: string;
    disabled?: boolean;
    busy?: boolean;
    tone?: 'neutral' | 'danger';
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type='button'
            aria-label={label}
            title={label}
            onClick={onClick}
            disabled={disabled}
            className={`${tone === 'danger' ? dashboardDangerActionClassName : dashboardIconActionClassName} size-9 min-h-0 px-0`}>
            {busy ? <span className='size-3 animate-pulse rounded-full bg-current' /> : children}
        </button>
    );
}

export function StatusMessage({ status }: { status: PanelStatus }) {
    const colorClass =
        status.tone === 'success'
            ? 'text-[var(--dash-success)]'
            : status.tone === 'error'
              ? 'text-[var(--dash-danger)]'
              : 'text-[var(--dash-text-muted)]';

    return (
        <p
            className={`text-sm leading-6 ${colorClass}`}
            role={status.tone === 'error' ? 'alert' : 'status'}
            aria-live={status.tone === 'error' ? 'assertive' : 'polite'}>
            {status.message}
        </p>
    );
}

export function RestorePointShortcutNotice({
    backupId,
    busy,
    disabled,
    onCreateRestoreDryRun,
}: {
    backupId: string;
    busy: boolean;
    disabled: boolean;
    onCreateRestoreDryRun: (backupId: string) => void;
}) {
    return (
        <DashboardStatus
            tone='warning'
            actions={
                <button
                    type='button'
                    onClick={() => onCreateRestoreDryRun(backupId)}
                    disabled={disabled}
                    className={`${dashboardSecondaryActionClassName} inline-flex min-h-8 items-center gap-2 text-xs`}>
                    <RotateCcw className='size-3.5' />
                    {busy ? 'Creating restore plan' : 'Plan restore with Match'}
                </button>
            }>
            Restore point saved before apply.
        </DashboardStatus>
    );
}

export function DashboardStructureLoading() {
    return (
        <DashboardSurface as='article' tone='subtle' aria-label='Loading server blueprint tools'>
            <div className='h-5 w-44 animate-pulse rounded bg-[var(--dash-surface-selected)]' />
            <div className='mt-3 h-4 w-64 animate-pulse rounded bg-[var(--dash-surface-raised)]' />
            <div className='mt-5 h-32 animate-pulse rounded bg-[var(--dash-surface-muted)]' />
        </DashboardSurface>
    );
}
