import { useQuery } from '@tanstack/react-query';

import { getDashboardModerationCasesQueryKey } from '../dashboard-query-keys.js';
import { readDashboardModerationCasesRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardModerationCase } from '../server/dashboard-moderation.server.js';

export function DashboardModerationCasesPanel({ guildId }: { guildId: string }) {
    const casesQuery = useQuery({
        queryKey: getDashboardModerationCasesQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardModerationCasesRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'cases') {
                throw new Error('Could not load moderation cases.');
            }

            return result.cases;
        },
    });

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy={casesQuery.isFetching}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-lg font-semibold text-white'>Case history</h2>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>
                        Recent moderation cases from bot commands and observed moderation events.
                    </p>
                </div>
                {casesQuery.isFetching ? (
                    <span className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300'>
                        Loading
                    </span>
                ) : null}
            </div>

            <ModerationCasesBody
                cases={casesQuery.data ?? []}
                isLoading={casesQuery.isPending}
                isError={casesQuery.isError}
            />
        </article>
    );
}

function ModerationCasesBody({
    cases,
    isLoading,
    isError,
}: {
    cases: DashboardModerationCase[];
    isLoading: boolean;
    isError: boolean;
}) {
    if (isLoading) {
        return (
            <div className='mt-4 space-y-3' aria-label='Loading moderation cases'>
                <div className='h-4 w-36 animate-pulse rounded bg-neutral-800' />
                <div className='h-4 w-64 animate-pulse rounded bg-neutral-800' />
                <div className='h-4 w-52 animate-pulse rounded bg-neutral-800' />
            </div>
        );
    }

    if (isError) {
        return <p className='mt-4 text-sm text-rose-300'>Could not load moderation cases.</p>;
    }

    if (cases.length === 0) {
        return (
            <p className='mt-4 text-sm leading-6 text-neutral-400'>
                No moderation cases yet. Cases appear here after commands or observed ban/unban events record actions.
            </p>
        );
    }

    return (
        <div className='mt-4 overflow-x-auto rounded-md border border-neutral-800'>
            <table className='w-full min-w-[44rem] text-left' aria-label='Moderation cases'>
                <thead className='border-b border-neutral-800 bg-neutral-950/70 text-xs font-medium tracking-wide text-neutral-500 uppercase'>
                    <tr>
                        <th scope='col' className='w-20 px-3 py-2'>
                            Case
                        </th>
                        <th scope='col' className='w-28 px-3 py-2'>
                            Action
                        </th>
                        <th scope='col' className='px-3 py-2'>
                            Target and reason
                        </th>
                        <th scope='col' className='w-32 px-3 py-2'>
                            Status
                        </th>
                    </tr>
                </thead>
                <tbody className='divide-y divide-neutral-800'>
                    {cases.map((moderationCase) => (
                        <ModerationCaseRow key={moderationCase.caseNumber} moderationCase={moderationCase} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ModerationCaseRow({ moderationCase }: { moderationCase: DashboardModerationCase }) {
    return (
        <tr className='text-sm text-neutral-200'>
            <td className='px-3 py-3 align-top font-mono font-semibold text-white'>#{moderationCase.caseNumber}</td>
            <td className='px-3 py-3 align-top'>
                <ActionBadge action={moderationCase.action} />
            </td>
            <td className='min-w-0 px-3 py-3 align-top'>
                <span className='block truncate font-mono text-xs text-neutral-300'>
                    {formatModerationCaseTarget(moderationCase)}
                </span>
                <span className='mt-1 block truncate text-neutral-500'>
                    {moderationCase.reason ?? 'No reason recorded'}
                </span>
                <span className='mt-1 block text-xs text-neutral-600'>
                    {moderationCase.actorUserId ? `Actor ${moderationCase.actorUserId}` : 'Actor unknown'} ·{' '}
                    {formatDateTime(moderationCase.createdAt)}
                </span>
            </td>
            <td className='px-3 py-3 align-top'>
                <StatusBadge status={moderationCase.status} />
            </td>
        </tr>
    );
}

function formatModerationCaseTarget(moderationCase: DashboardModerationCase): string {
    if (moderationCase.targetType === 'channel') {
        return moderationCase.targetChannelId ? `#${moderationCase.targetChannelId}` : 'Unknown channel';
    }

    return moderationCase.targetUserId ?? 'Unknown user';
}

function ActionBadge({ action }: { action: string }) {
    const tone = getActionTone(action);

    return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${tone}`}>{action}</span>;
}

function StatusBadge({ status }: { status: string }) {
    const tone =
        status === 'resolved'
            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'
            : status === 'void'
              ? 'border-neutral-600 bg-neutral-800 text-neutral-300'
              : 'border-amber-400/40 bg-amber-400/10 text-amber-100';

    return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${tone}`}>{status}</span>;
}

function getActionTone(action: string): string {
    switch (action) {
        case 'ban':
            return 'border-rose-400/40 bg-rose-400/10 text-rose-100';
        case 'kick':
            return 'border-orange-400/40 bg-orange-400/10 text-orange-100';
        case 'unban':
            return 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100';
        case 'warn':
            return 'border-amber-400/40 bg-amber-400/10 text-amber-100';
        case 'purge':
            return 'border-violet-400/40 bg-violet-400/10 text-violet-100';
        default:
            return 'border-neutral-700 bg-neutral-800 text-neutral-200';
    }
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
