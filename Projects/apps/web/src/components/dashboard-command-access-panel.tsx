import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardCommandAccessQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardCommandAccessRouteData,
    readDashboardCommandAccessRouteData,
    updateDashboardCommandAccessRouteData,
} from '../server/dashboard-guild-route-data.js';
import type {
    DashboardCommandAccessCatalog,
    DashboardCommandAccessRole,
    DashboardCommandAccessRoleReadStatus,
    DashboardCommandAccessRule,
    DashboardCommandAccessTargetType,
} from '../server/dashboard-command-access.server.js';
import { CommandAccessRolePicker, matchCommandAccessRoles } from './dashboard-command-access-role-picker.js';

type FormState = {
    targetType: DashboardCommandAccessTargetType;
    targetId: string;
    userIdsText: string;
    roleSearch: string;
    roleIds: string[];
};

type PanelStatus = {
    tone: 'success' | 'error' | 'neutral';
    message: string;
};

export function DashboardCommandAccessPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardCommandAccessQueryKey(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
    const [busyTargetKey, setBusyTargetKey] = useState<string | undefined>();
    const accessQuery = useQuery({
        queryKey,
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

    async function refreshAccess(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey });
    }

    async function saveRule(input: {
        targetType: DashboardCommandAccessTargetType;
        targetId: string;
        userIds: string[];
        roleIds: string[];
    }): Promise<void> {
        const targetKey = getRuleKey(input.targetType, input.targetId);

        setStatus(undefined);
        setBusyTargetKey(targetKey);

        try {
            const result = await updateDashboardCommandAccessRouteData({
                data: {
                    guildId,
                    targetType: input.targetType,
                    targetId: input.targetId,
                    userIds: input.userIds,
                    roleIds: input.roleIds,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus({ tone: 'success', message: 'Command access saved.' });
            await refreshAccess();
        } finally {
            setBusyTargetKey(undefined);
        }
    }

    async function deleteRule(rule: DashboardCommandAccessRule): Promise<void> {
        const targetKey = getRuleKey(rule.targetType, rule.targetId);

        setStatus(undefined);
        setBusyTargetKey(targetKey);

        try {
            const result = await deleteDashboardCommandAccessRouteData({
                data: {
                    guildId,
                    targetType: rule.targetType,
                    targetId: rule.targetId,
                },
            });

            if (result.type !== 'deleted') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus({ tone: 'success', message: 'Command access removed.' });
            await refreshAccess();
        } finally {
            setBusyTargetKey(undefined);
        }
    }

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
                    Grant roles or users access to guarded bot commands. Dashboard access still requires Manage Server.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <CommandAccessEditor
                    catalog={access.catalog}
                    roles={access.roles}
                    roleReadStatus={access.roleReadStatus}
                    isBusy={Boolean(busyTargetKey)}
                    onSave={(input) => void saveRule(input)}
                />
                <CommandAccessRuleList
                    catalog={access.catalog}
                    roles={access.roles}
                    rules={access.rules}
                    busyTargetKey={busyTargetKey}
                    onDelete={(rule) => void deleteRule(rule)}
                />
            </div>
            {status ? <StatusMessage status={status} /> : null}
        </article>
    );
}

function CommandAccessEditor({
    catalog,
    roles,
    roleReadStatus,
    isBusy,
    onSave,
}: {
    catalog: DashboardCommandAccessCatalog;
    roles: DashboardCommandAccessRole[];
    roleReadStatus: DashboardCommandAccessRoleReadStatus;
    isBusy: boolean;
    onSave: (input: {
        targetType: DashboardCommandAccessTargetType;
        targetId: string;
        userIds: string[];
        roleIds: string[];
    }) => void;
}) {
    const [form, setForm] = useState<FormState>(() => ({
        targetType: 'category',
        targetId: catalog.categories[0]?.id ?? '',
        userIdsText: '',
        roleSearch: '',
        roleIds: [],
    }));
    const selectedRoles = useMemo(
        () => form.roleIds.map((roleId) => roles.find((role) => role.id === roleId) ?? toUnknownRole(roleId)),
        [form.roleIds, roles]
    );
    const matchedRoles = useMemo(
        () =>
            matchCommandAccessRoles(
                roles.filter((role) => !form.roleIds.includes(role.id)),
                form.roleSearch
            ).slice(0, 8),
        [form.roleIds, form.roleSearch, roles]
    );
    const targetOptions = form.targetType === 'category' ? catalog.categories : catalog.commands;
    const canSave =
        form.targetId.trim().length > 0 && (parseIds(form.userIdsText).length > 0 || form.roleIds.length > 0);

    function updateTargetType(targetType: DashboardCommandAccessTargetType): void {
        setForm((current) => ({
            ...current,
            targetType,
            targetId: targetType === 'category' ? (catalog.categories[0]?.id ?? '') : (catalog.commands[0]?.id ?? ''),
        }));
    }

    return (
        <section className='p-4' aria-labelledby='command-access-editor-heading'>
            <h4 id='command-access-editor-heading' className='text-sm font-semibold text-white'>
                Add or update grant
            </h4>
            <div className='mt-3 grid grid-cols-2 gap-2'>
                <TargetTypeButton
                    label='Category'
                    selected={form.targetType === 'category'}
                    onClick={() => updateTargetType('category')}
                />
                <TargetTypeButton
                    label='Command'
                    selected={form.targetType === 'command'}
                    onClick={() => updateTargetType('command')}
                />
            </div>
            <label className='mt-4 block space-y-2 text-sm font-medium text-neutral-200'>
                <span>{form.targetType === 'category' ? 'Command category' : 'Command'}</span>
                <select
                    value={form.targetId}
                    onChange={(event) => {
                        const targetId = event.currentTarget.value;

                        setForm((current) => ({ ...current, targetId }));
                    }}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                    {targetOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                            {option.id} - {'commandName' in option ? option.commandName : option.title}
                        </option>
                    ))}
                </select>
            </label>
            <CommandAccessRolePicker
                roles={roles}
                roleReadStatus={roleReadStatus}
                selectedRoles={selectedRoles}
                matchedRoles={matchedRoles}
                search={form.roleSearch}
                onSearchChange={(roleSearch) => setForm((current) => ({ ...current, roleSearch }))}
                onAddRole={(roleId) =>
                    setForm((current) => ({
                        ...current,
                        roleSearch: '',
                        roleIds: [...current.roleIds, roleId],
                    }))
                }
                onRemoveRole={(roleId) =>
                    setForm((current) => ({
                        ...current,
                        roleIds: current.roleIds.filter((currentRoleId) => currentRoleId !== roleId),
                    }))
                }
            />
            <label className='mt-4 block space-y-2 text-sm font-medium text-neutral-200'>
                <span>User IDs</span>
                <textarea
                    value={form.userIdsText}
                    onChange={(event) => {
                        const userIdsText = event.currentTarget.value;

                        setForm((current) => ({ ...current, userIdsText }));
                    }}
                    rows={4}
                    spellCheck={false}
                    className='w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    placeholder='One Fluxer/Discord user ID per line'
                />
            </label>
            <button
                type='button'
                onClick={() =>
                    onSave({
                        targetType: form.targetType,
                        targetId: form.targetId,
                        userIds: parseIds(form.userIdsText),
                        roleIds: form.roleIds,
                    })
                }
                disabled={isBusy || !canSave}
                className='mt-4 min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                Save command grant
            </button>
        </section>
    );
}

function CommandAccessRuleList({
    catalog,
    roles,
    rules,
    busyTargetKey,
    onDelete,
}: {
    catalog: DashboardCommandAccessCatalog;
    roles: DashboardCommandAccessRole[];
    rules: DashboardCommandAccessRule[];
    busyTargetKey: string | undefined;
    onDelete: (rule: DashboardCommandAccessRule) => void;
}) {
    const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
    const targetLabels = useMemo(() => createTargetLabels(catalog), [catalog]);

    return (
        <section className='p-4' aria-labelledby='current-command-grants-heading'>
            <h4 id='current-command-grants-heading' className='text-sm font-semibold text-white'>
                Current grants
            </h4>
            {rules.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No command grants are configured yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[42rem] text-left text-sm'>
                        <thead className='border-b border-neutral-800 text-xs text-neutral-500 uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Target</th>
                                <th className='px-3 py-2 font-semibold'>Allowed roles</th>
                                <th className='px-3 py-2 font-semibold'>Allowed users</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-neutral-800'>
                            {rules.map((rule) => (
                                <CommandAccessRuleRow
                                    key={getRuleKey(rule.targetType, rule.targetId)}
                                    rule={rule}
                                    targetLabel={targetLabels.get(getRuleKey(rule.targetType, rule.targetId))}
                                    rolesById={rolesById}
                                    isBusy={busyTargetKey === getRuleKey(rule.targetType, rule.targetId)}
                                    onDelete={onDelete}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function CommandAccessRuleRow({
    rule,
    targetLabel,
    rolesById,
    isBusy,
    onDelete,
}: {
    rule: DashboardCommandAccessRule;
    targetLabel: string | undefined;
    rolesById: Map<string, DashboardCommandAccessRole>;
    isBusy: boolean;
    onDelete: (rule: DashboardCommandAccessRule) => void;
}) {
    return (
        <tr>
            <td className='py-3 pr-3 align-top'>
                <p className='font-medium text-neutral-100'>{targetLabel ?? rule.targetId}</p>
                <p className='mt-1 font-mono text-xs text-neutral-500'>
                    {rule.targetType}:{rule.targetId}
                </p>
            </td>
            <td className='px-3 py-3 align-top text-neutral-300'>
                {rule.roleIds.length > 0 ? (
                    <ul className='space-y-1'>
                        {rule.roleIds.map((roleId) => (
                            <li key={roleId}>
                                {rolesById.get(roleId)?.name ?? roleId}
                                <span className='ml-2 font-mono text-xs text-neutral-500'>{roleId}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className='text-neutral-500'>None</span>
                )}
            </td>
            <td className='px-3 py-3 align-top text-neutral-300'>
                {rule.userIds.length > 0 ? (
                    <ul className='space-y-1 font-mono text-xs'>
                        {rule.userIds.map((userId) => (
                            <li key={userId}>{userId}</li>
                        ))}
                    </ul>
                ) : (
                    <span className='text-neutral-500'>None</span>
                )}
            </td>
            <td className='py-3 pl-3 text-right align-top'>
                <button
                    type='button'
                    onClick={() => onDelete(rule)}
                    disabled={isBusy}
                    className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                    Remove
                </button>
            </td>
        </tr>
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

function TargetTypeButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
    return (
        <button
            type='button'
            onClick={onClick}
            aria-pressed={selected}
            className={`min-h-10 rounded-md border px-3 text-sm font-semibold transition ${
                selected
                    ? 'border-sky-300 bg-sky-300 text-neutral-950'
                    : 'border-neutral-700 text-neutral-200 hover:border-sky-400 hover:text-sky-200'
            }`}>
            {label}
        </button>
    );
}

function StatusMessage({ status }: { status: PanelStatus }) {
    const colorClass =
        status.tone === 'success' ? 'text-emerald-300' : status.tone === 'error' ? 'text-rose-300' : 'text-neutral-400';

    return <p className={`border-t border-neutral-800 px-4 py-3 text-sm ${colorClass}`}>{status.message}</p>;
}

function createTargetLabels(catalog: DashboardCommandAccessCatalog): Map<string, string> {
    return new Map([
        ...catalog.categories.map((category) => [getRuleKey('category', category.id), category.title] as const),
        ...catalog.commands.map(
            (command) =>
                [getRuleKey('command', command.id), `${command.categoryTitle}: ${command.commandName}`] as const
        ),
    ]);
}

function parseIds(value: string): string[] {
    return [
        ...new Set(
            value
                .split(/[\s,]+/)
                .map((id) => id.trim())
                .filter(Boolean)
        ),
    ];
}

function toUnknownRole(roleId: string): DashboardCommandAccessRole {
    return {
        id: roleId,
        name: roleId,
        position: 0,
    };
}

function getRuleKey(targetType: DashboardCommandAccessTargetType, targetId: string): string {
    return `${targetType}:${targetId}`;
}

function toMutationStatus(type: string): PanelStatus {
    const messages: Record<string, string> = {
        'invalid-target': 'Choose a grantable category or command.',
        'auth-required': 'Sign in again before changing command access.',
        'not-found': 'This command access rule or server is no longer available.',
        'deployment-config-not-found': 'Dashboard deployment config is missing.',
        'database-error': 'The dashboard database could not save command access.',
        'guild-lookup-failed': 'This server could not be loaded from Fluxer.',
    };

    return {
        tone: 'error',
        message: messages[type] ?? 'Could not save command access.',
    };
}
