import { RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import type { PanelStatus } from './dashboard-structure-panel-types.js';

export function MiniCount({ label, value }: { label: string; value: number }) {
    return (
        <div className='rounded border border-neutral-800 bg-neutral-900/70 px-2 py-1.5'>
            <p className='text-xs font-semibold text-neutral-200'>{value}</p>
            <p className='mt-0.5 text-[0.68rem] text-neutral-500 uppercase'>{label}</p>
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
    const toneClass =
        tone === 'danger'
            ? 'border-neutral-700 text-rose-200 hover:border-rose-400 hover:text-rose-100'
            : 'border-neutral-700 text-neutral-100 hover:border-sky-400 hover:text-sky-200';

    return (
        <button
            type='button'
            aria-label={label}
            title={label}
            onClick={onClick}
            disabled={disabled}
            className={`grid size-9 place-items-center rounded-md border transition disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600 ${toneClass}`}>
            {busy ? <span className='size-3 animate-pulse rounded-full bg-current' /> : children}
        </button>
    );
}

export function StatusMessage({ status }: { status: PanelStatus }) {
    const colorClass =
        status.tone === 'success' ? 'text-emerald-300' : status.tone === 'error' ? 'text-rose-300' : 'text-neutral-400';

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
        <div className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm'>
            <p className='text-amber-100'>Restore point saved before apply.</p>
            <button
                type='button'
                onClick={() => onCreateRestoreDryRun(backupId)}
                disabled={disabled}
                className='inline-flex min-h-8 items-center gap-2 rounded-md border border-amber-300/50 px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-200 hover:text-white disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-500'>
                <RotateCcw className='size-3.5' />
                {busy ? 'Creating restore dry-run' : 'Create restore dry-run'}
            </button>
        </div>
    );
}

export function DashboardStructureLoading() {
    return (
        <article
            className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'
            aria-label='Loading server blueprint tools'>
            <div className='h-5 w-44 animate-pulse rounded bg-neutral-800' />
            <div className='mt-3 h-4 w-64 animate-pulse rounded bg-neutral-800' />
            <div className='mt-5 h-32 animate-pulse rounded bg-neutral-950' />
        </article>
    );
}
