import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardModerationPolicyQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardModerationPolicyRouteData,
    updateDashboardModerationPolicyRouteData,
} from '../server/dashboard-guild-route-data.js';
import type { DashboardModerationPolicy } from '../server/dashboard-moderation.server.js';
import { DashboardEntitySelector } from './dashboard-entity-selector.js';
import type { DashboardEntityOption } from './dashboard-entity-selector.js';

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

            return result;
        },
    });
    return (
        <article className='dashboard-glass-panel p-5' aria-busy={policyQuery.isFetching}>
            <div>
                <h2 className='text-xl font-semibold text-[var(--dash-text)]'>Protection policy</h2>
                <p className='mt-2 text-sm leading-6 text-[var(--dash-text-muted)]'>
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
                    policy={policyQuery.data.policy}
                    policyQueryKey={policyQueryKey}
                    queryClient={queryClient}
                    roles={policyQuery.data.roles}
                    structureReadStatus={policyQuery.data.structureReadStatus}
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
    roles,
    structureReadStatus,
}: {
    guildId: string;
    policy: DashboardModerationPolicy;
    policyQueryKey: ReturnType<typeof getDashboardModerationPolicyQueryKey>;
    queryClient: ReturnType<typeof useQueryClient>;
    roles: { id: string; name: string; color: number }[];
    structureReadStatus: string;
}) {
    const [protectedUserIds, setProtectedUserIds] = useState(policy.protectedUserIds);
    const [protectedRoleIds, setProtectedRoleIds] = useState(policy.protectedRoleIds);
    const [saveMessage, setSaveMessage] = useState<string | undefined>();
    const roleOptions = useMemo<DashboardEntityOption[]>(
        () => roles.map((role) => ({ id: role.id, name: role.name, color: role.color })),
        [roles]
    );
    const userOptions = useMemo<DashboardEntityOption[]>(
        () => protectedUserIds.map((userId) => ({ id: userId, name: userId })),
        [protectedUserIds]
    );
    const mutation = useMutation({
        mutationFn: async () => {
            const result = await updateDashboardModerationPolicyRouteData({
                data: {
                    guildId,
                    protectedUserIds,
                    protectedRoleIds,
                },
            });

            if (result.type !== 'updated') {
                throw new Error('Could not save moderation policy.');
            }

            return result.policy;
        },
        onSuccess(updatedPolicy) {
            queryClient.setQueryData(policyQueryKey, (current: unknown) =>
                current && typeof current === 'object'
                    ? { ...current, policy: updatedPolicy }
                    : {
                          type: 'policy',
                          policy: updatedPolicy,
                          structureReadStatus,
                          roles,
                      }
            );
            setSaveMessage('Moderation policy saved.');
        },
        onError() {
            setSaveMessage(undefined);
        },
    });

    return (
        <form
            className='mt-5 grid gap-4 lg:grid-cols-2'
            onSubmit={(event) => {
                event.preventDefault();
                setSaveMessage(undefined);
                mutation.mutate();
            }}>
            <DashboardEntitySelector
                kind='user'
                label='Protected users'
                options={userOptions}
                selectedIds={protectedUserIds}
                unavailableText='User search is not available yet.'
                onSelectedIdsChange={setProtectedUserIds}
            />
            <DashboardEntitySelector
                kind='role'
                label='Protected roles'
                options={roleOptions}
                selectedIds={protectedRoleIds}
                unavailableText={
                    structureReadStatus === 'available' ? undefined : toStructureUnavailableText(structureReadStatus)
                }
                onSelectedIdsChange={setProtectedRoleIds}
            />
            <div className='flex flex-wrap items-center gap-3 lg:col-span-2'>
                <button
                    type='submit'
                    disabled={mutation.isPending}
                    className='dashboard-primary-button min-h-10 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60'>
                    {mutation.isPending ? 'Saving...' : 'Save policy'}
                </button>
                {mutation.isError ? <p className='text-sm text-rose-300'>Could not save moderation policy.</p> : null}
                {saveMessage ? <p className='text-sm text-[var(--dash-primary)]'>{saveMessage}</p> : null}
            </div>
        </form>
    );
}

function PolicyLoading() {
    return (
        <div className='mt-4 grid gap-4 lg:grid-cols-2' aria-label='Loading moderation policy'>
            <div className='h-32 animate-pulse rounded-[var(--dash-radius-panel)] bg-[var(--dash-surface-raised)]' />
            <div className='h-32 animate-pulse rounded-[var(--dash-radius-panel)] bg-[var(--dash-surface-raised)]' />
        </div>
    );
}

function toStructureUnavailableText(status: string): string {
    return status === 'bot-token-missing'
        ? 'Set FLUXER_BOT_TOKEN to load server roles.'
        : 'Could not load server roles.';
}
