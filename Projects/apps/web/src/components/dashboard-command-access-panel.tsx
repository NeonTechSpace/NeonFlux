import { useQuery } from '@tanstack/react-query';

import { getDashboardCommandAccessQueryKey } from '../dashboard-query-keys.js';
import { readDashboardCommandAccessRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardCommandAccessRule } from '../server/dashboard-command-access.server.js';

export function DashboardCommandAccessPanel({ guildId }: { guildId: string }) {
    const accessQuery = useQuery({
        queryKey: getDashboardCommandAccessQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardCommandAccessRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'access') {
                throw new Error('Could not load command access.');
            }

            return result;
        },
    });

    if (accessQuery.isPending) {
        return <DashboardCommandAccessLoading />;
    }

    if (accessQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Command access</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load command access.</p>
            </article>
        );
    }

    const access = accessQuery.data;

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Command access</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Command grants apply to bot commands only. Dashboard access still requires Manage Server.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:divide-x lg:divide-y-0'>
                <section className='p-4' aria-labelledby='grantable-commands-heading'>
                    <h4 id='grantable-commands-heading' className='text-sm font-semibold text-white'>
                        Grantable commands
                    </h4>
                    <ul className='mt-3 space-y-3'>
                        {access.catalog.commands.map((command) => (
                            <li key={command.id} className='min-w-0'>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <span className='rounded-md border border-neutral-700 px-2 py-1 font-mono text-xs text-sky-200'>
                                        {command.id}
                                    </span>
                                    <span className='text-sm text-neutral-400'>{command.categoryTitle}</span>
                                </div>
                                <p className='mt-1 text-sm leading-6 text-neutral-300'>{command.description}</p>
                            </li>
                        ))}
                    </ul>
                </section>
                <section className='p-4' aria-labelledby='current-command-grants-heading'>
                    <h4 id='current-command-grants-heading' className='text-sm font-semibold text-white'>
                        Current grants
                    </h4>
                    {access.rules.length === 0 ? (
                        <p className='mt-3 text-sm leading-6 text-neutral-400'>No command grants are configured yet.</p>
                    ) : (
                        <ul className='mt-3 space-y-3'>
                            {access.rules.map((rule) => (
                                <li
                                    key={`${rule.targetType}:${rule.targetId}`}
                                    className='rounded-md border border-neutral-800 bg-neutral-950/50 p-3'>
                                    <p className='font-mono text-xs text-neutral-300'>
                                        {rule.targetType}:{rule.targetId}
                                    </p>
                                    <p className='mt-2 text-sm text-neutral-400'>{formatGrantSummary(rule)}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </article>
    );
}

export function DashboardCommandAccessLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-40 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 space-y-3'>
                <div className='h-4 w-64 animate-pulse rounded bg-neutral-800' />
                <div className='h-4 w-48 animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function formatGrantSummary(rule: DashboardCommandAccessRule): string {
    const userText = `${rule.userIds.length} user${rule.userIds.length === 1 ? '' : 's'}`;
    const roleText = `${rule.roleIds.length} role${rule.roleIds.length === 1 ? '' : 's'}`;

    return `${userText}, ${roleText}`;
}
