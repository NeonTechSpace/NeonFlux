import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getDashboardModerationPolicyQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardModerationPolicyRouteData,
    updateDashboardModerationPolicyRouteData,
} from '../server/dashboard-guild-route-data.js';
import type { DashboardModerationPolicy } from '../server/dashboard-moderation.server.js';

export function DashboardModerationPolicyPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const policyQueryKey = getDashboardModerationPolicyQueryKey(guildId);
    const policyQuery = useQuery({
        queryKey: policyQueryKey,
        queryFn: async () => {
            const result = await readDashboardModerationPolicyRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'policy') {
                throw new Error('Could not load moderation policy.');
            }

            return result.policy;
        },
    });
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy={policyQuery.isFetching}>
            <div>
                <h2 className='text-lg font-semibold text-white'>Protection policy</h2>
                <p className='mt-2 text-sm leading-6 text-neutral-400'>
                    Protected users and roles cannot be kicked, banned, or unbanned by NeonFlux commands.
                </p>
            </div>

            {policyQuery.isPending ? <PolicyLoading /> : null}
            {policyQuery.isError ? (
                <p className='mt-4 text-sm text-rose-300'>Could not load moderation policy.</p>
            ) : null}
            {policyQuery.isSuccess ? (
                <ModerationPolicyForm
                    key={guildId}
                    guildId={guildId}
                    policy={policyQuery.data}
                    policyQueryKey={policyQueryKey}
                    queryClient={queryClient}
                />
            ) : null}
        </article>
    );
}

function ModerationPolicyForm({
    guildId,
    policy,
    policyQueryKey,
    queryClient,
}: {
    guildId: string;
    policy: DashboardModerationPolicy;
    policyQueryKey: ReturnType<typeof getDashboardModerationPolicyQueryKey>;
    queryClient: ReturnType<typeof useQueryClient>;
}) {
    const [protectedUserIds, setProtectedUserIds] = useState(policy.protectedUserIds.join('\n'));
    const [protectedRoleIds, setProtectedRoleIds] = useState(policy.protectedRoleIds.join('\n'));
    const [saveMessage, setSaveMessage] = useState<string | undefined>();
    const mutation = useMutation({
        mutationFn: async () => {
            const result = await updateDashboardModerationPolicyRouteData({
                data: {
                    guildId,
                    protectedUserIds: parseIdList(protectedUserIds),
                    protectedRoleIds: parseIdList(protectedRoleIds),
                },
            });

            if (result.type !== 'updated') {
                throw new Error('Could not save moderation policy.');
            }

            return result.policy;
        },
        onSuccess(updatedPolicy) {
            queryClient.setQueryData(policyQueryKey, updatedPolicy);
            setSaveMessage('Moderation policy saved.');
        },
        onError() {
            setSaveMessage(undefined);
        },
    });

    return (
        <form
            className='mt-4 grid gap-4 lg:grid-cols-2'
            onSubmit={(event) => {
                event.preventDefault();
                setSaveMessage(undefined);
                mutation.mutate();
            }}>
            <PolicyTextarea
                label='Protected user IDs'
                value={protectedUserIds}
                onChange={setProtectedUserIds}
                placeholder='1517169145576165376'
            />
            <PolicyTextarea
                label='Protected role IDs'
                value={protectedRoleIds}
                onChange={setProtectedRoleIds}
                placeholder='1514728169414852609'
            />
            <div className='flex flex-wrap items-center gap-3 lg:col-span-2'>
                <button
                    type='submit'
                    disabled={mutation.isPending}
                    className='min-h-10 rounded-md bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'>
                    {mutation.isPending ? 'Saving...' : 'Save policy'}
                </button>
                {mutation.isError ? <p className='text-sm text-rose-300'>Could not save moderation policy.</p> : null}
                {saveMessage ? <p className='text-sm text-emerald-300'>{saveMessage}</p> : null}
            </div>
        </form>
    );
}

function PolicyTextarea({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
}) {
    return (
        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
            <span>{label}</span>
            <textarea
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className='min-h-32 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                placeholder={placeholder}
                spellCheck={false}
            />
        </label>
    );
}

function PolicyLoading() {
    return (
        <div className='mt-4 grid gap-4 lg:grid-cols-2' aria-label='Loading moderation policy'>
            <div className='h-32 animate-pulse rounded-md bg-neutral-800' />
            <div className='h-32 animate-pulse rounded-md bg-neutral-800' />
        </div>
    );
}

function parseIdList(value: string): string[] {
    return [
        ...new Set(
            value
                .split(/[\s,]+/u)
                .map((entry) => entry.trim())
                .filter(Boolean)
        ),
    ];
}
