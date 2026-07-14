import { RotateCcw } from 'lucide-react';

import type { PanelStatus } from './dashboard-blueprint-panel-types.js';
import { dashboardSecondaryActionClassName, DashboardStatus } from './dashboard-ui.js';

export function MiniCount({ label, value }: { label: string; value: number }) {
    return (
        <div className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-2 py-1.5'>
            <p className='text-xs font-semibold text-[var(--dash-text)]'>{value}</p>
            <p className='mt-0.5 text-[0.68rem] text-[var(--dash-text-subtle)] uppercase'>{label}</p>
        </div>
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
    onCreateRestorePlan,
}: {
    backupId: string;
    busy: boolean;
    disabled: boolean;
    onCreateRestorePlan: (backupId: string) => void;
}) {
    return (
        <DashboardStatus
            tone='warning'
            actions={
                <button
                    type='button'
                    onClick={() => onCreateRestorePlan(backupId)}
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

export function DashboardBlueprintLoading() {
    return (
        <div
            role='status'
            aria-label='Loading server blueprint data'
            className='flex min-h-12 items-center gap-3 py-4 text-sm text-[var(--dash-text-muted)]'>
            <span
                data-dashboard-loading='pulse'
                className='size-2 shrink-0 animate-pulse rounded-full bg-[var(--dash-primary)]'
                aria-hidden='true'
            />
            Loading Blueprint data…
        </div>
    );
}
