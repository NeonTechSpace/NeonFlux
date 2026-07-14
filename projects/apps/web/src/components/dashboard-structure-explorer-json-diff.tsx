import { FileDiff } from '@pierre/diffs/react';

import type {
    DashboardStructureExplorerComparisonTarget,
    DashboardStructureExplorerSource,
} from './dashboard-structure-explorer-types.js';
import type { DashboardStructureExplorerJsonDiff } from './dashboard-structure-explorer-diff.js';

export function DashboardStructureExplorerJsonDiffView({
    comparisonTarget,
    jsonDiff,
    source,
}: {
    comparisonTarget: DashboardStructureExplorerComparisonTarget;
    jsonDiff: DashboardStructureExplorerJsonDiff | undefined;
    source: DashboardStructureExplorerSource;
}) {
    if (!source.canonicalJson) {
        return (
            <div className='p-3'>
                <DiffEmptyState message='Load live, inspect a backup, or inspect import JSON before comparing.' />
            </div>
        );
    }

    if (!comparisonTarget.canonicalJson || !jsonDiff) {
        return (
            <div className='space-y-3 p-3'>
                <DiffHeader comparisonTarget={comparisonTarget} source={source} />
                <DiffEmptyState message='Choose a comparison target to render a JSON diff.' />
            </div>
        );
    }

    return (
        <div className='space-y-3 p-3'>
            <DiffHeader comparisonTarget={comparisonTarget} source={source} />
            {jsonDiff.type === 'same' ? (
                <DiffEmptyState message='No JSON differences found.' />
            ) : jsonDiff.type === 'capped' ? (
                <div className='rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-4'>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>
                        JSON diff is too large to render inline.
                    </p>
                    <p className='mt-2 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        Source JSON is {jsonDiff.beforeLength.toLocaleString()} characters and comparison JSON is{' '}
                        {jsonDiff.afterLength.toLocaleString()} characters. Inline rendering is capped at{' '}
                        {jsonDiff.limit.toLocaleString()} combined characters.
                    </p>
                </div>
            ) : (
                <div className='max-h-[min(34rem,65dvh)] overflow-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)]'>
                    <FileDiff
                        fileDiff={jsonDiff.fileDiff}
                        options={{
                            diffStyle: 'unified',
                            disableFileHeader: true,
                            overflow: 'wrap',
                        }}
                    />
                </div>
            )}
        </div>
    );
}

function DiffHeader({
    comparisonTarget,
    source,
}: {
    comparisonTarget: DashboardStructureExplorerComparisonTarget;
    source: DashboardStructureExplorerSource;
}) {
    return (
        <div className='grid gap-2 sm:grid-cols-2'>
            <DiffSourceTile label='Source' title={source.label} detail={source.detail} />
            <DiffSourceTile label='Comparison' title={comparisonTarget.label} detail={comparisonTarget.detail} />
        </div>
    );
}

function DiffSourceTile({ detail, label, title }: { detail?: string; label: string; title: string }) {
    return (
        <div className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-2'>
            <p className='text-xs font-medium text-[var(--dash-text-subtle)] uppercase'>{label}</p>
            <p className='mt-1 text-sm font-semibold text-[var(--dash-text)]'>{title}</p>
            {detail ? <p className='mt-1 text-xs text-[var(--dash-text-subtle)]'>{detail}</p> : null}
        </div>
    );
}

function DiffEmptyState({ message }: { message: string }) {
    return (
        <div className='rounded-[var(--dash-radius-control)] border border-dashed border-[var(--dash-border-strong)] bg-[var(--dash-surface-muted)] p-4'>
            <p className='text-sm font-semibold text-[var(--dash-text)]'>JSON diff</p>
            <p className='mt-2 text-xs leading-5 text-[var(--dash-text-muted)]'>{message}</p>
        </div>
    );
}
