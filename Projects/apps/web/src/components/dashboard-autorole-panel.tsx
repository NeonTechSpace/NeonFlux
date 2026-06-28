import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardAutoroleSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardAutoroleRuleRouteData,
    readDashboardAutoroleSettingsRouteData,
    updateDashboardAutoroleRuleRouteData,
} from '../server/dashboard-autorole-route-data.js';
import type { DashboardAutoroleRole, DashboardAutoroleRule } from '../server/dashboard-autorole.server.js';

export function DashboardAutorolePanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const settingsQuery = useQuery({
        queryKey: getDashboardAutoroleSettingsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardAutoroleSettingsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'settings') {
                throw new Error('Could not load autorole settings.');
            }

            return result;
        },
    });

    async function invalidateAutoroleSettings(): Promise<void> {
        await queryClient.invalidateQueries({
            queryKey: getDashboardAutoroleSettingsQueryKey(guildId),
        });
    }

    if (settingsQuery.isPending) {
        return <DashboardAutoroleLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Autorole</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load autorole settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Autorole</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Assign selected roles when a member joins. NeonFlux skips roles it cannot safely manage.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:divide-x lg:divide-y-0'>
                <AutoroleRuleEditor
                    guildId={guildId}
                    roles={settingsQuery.data.roles}
                    roleReadStatus={settingsQuery.data.roleReadStatus}
                    onChanged={invalidateAutoroleSettings}
                />
                <AutoroleRuleList
                    guildId={guildId}
                    roles={settingsQuery.data.roles}
                    rules={settingsQuery.data.rules}
                    onChanged={invalidateAutoroleSettings}
                />
            </div>
        </article>
    );
}

function AutoroleRuleEditor({
    guildId,
    roles,
    roleReadStatus,
    onChanged,
}: {
    guildId: string;
    roles: DashboardAutoroleRole[];
    roleReadStatus: string;
    onChanged: () => Promise<void>;
}) {
    const [search, setSearch] = useState('');
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [status, setStatus] = useState<string | undefined>();
    const selectedRole = roles.find((role) => role.id === selectedRoleId);
    const matchedRoles = useMemo(() => matchRoles(roles, search).slice(0, 8), [roles, search]);
    const roleSearch = selectedRole && search === selectedRoleId ? formatRoleLabel(selectedRole) : search;

    async function saveRule(): Promise<void> {
        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await updateDashboardAutoroleRuleRouteData({
                data: {
                    guildId,
                    roleId: selectedRoleId,
                    ...(selectedRole ? { name: selectedRole.name } : {}),
                    enabled,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setSearch('');
            setSelectedRoleId('');
            setEnabled(true);
            setStatus('Saved.');
            await onChanged();
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <section className='p-4' aria-labelledby='autorole-editor-heading'>
            <h4 id='autorole-editor-heading' className='text-sm font-semibold text-white'>
                Add role
            </h4>
            {roleReadStatus === 'bot-token-missing' ? (
                <p className='mt-3 text-sm leading-6 text-rose-300'>Set FLUXER_BOT_TOKEN for the web service.</p>
            ) : null}
            {roleReadStatus === 'fetch-failed' ? (
                <p className='mt-3 text-sm leading-6 text-rose-300'>Could not read server roles.</p>
            ) : null}
            <label className='mt-3 block space-y-2 text-sm font-medium text-neutral-200'>
                <span>Role</span>
                <input
                    value={roleSearch}
                    onBlur={() => setIsOpen(false)}
                    onChange={(event) => {
                        setSearch(event.currentTarget.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    autoComplete='off'
                    role='combobox'
                    aria-autocomplete='list'
                    aria-controls='autorole-role-options'
                    aria-expanded={isOpen}
                    placeholder='Search roles'
                    disabled={roles.length === 0}
                />
            </label>
            {isOpen && roles.length > 0 ? (
                <ul
                    id='autorole-role-options'
                    className='mt-2 max-h-56 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950'
                    role='listbox'>
                    {matchedRoles.length > 0 ? (
                        matchedRoles.map((role) => (
                            <li key={role.id} role='option' aria-selected={selectedRoleId === role.id}>
                                <button
                                    type='button'
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                        setSelectedRoleId(role.id);
                                        setSearch(formatRoleLabel(role));
                                        setIsOpen(false);
                                    }}
                                    className='flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm text-neutral-100 transition hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none'>
                                    <span className='min-w-0 truncate'>{role.name}</span>
                                    <span className='shrink-0 font-mono text-xs text-neutral-500'>{role.id}</span>
                                </button>
                            </li>
                        ))
                    ) : (
                        <li className='px-3 py-3 text-sm text-neutral-500'>No matching roles.</li>
                    )}
                </ul>
            ) : null}
            <label className='mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-medium text-neutral-200'>
                <input
                    type='checkbox'
                    checked={enabled}
                    onChange={(event) => setEnabled(event.currentTarget.checked)}
                    className='size-4 accent-sky-400'
                />
                Enabled
            </label>
            <button
                type='button'
                onClick={() => void saveRule()}
                disabled={isSaving || !selectedRoleId}
                className='mt-4 min-h-10 w-full rounded-md bg-sky-400 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                Save autorole
            </button>
            {status ? <p className='mt-3 text-sm text-neutral-400'>{status}</p> : null}
        </section>
    );
}

function AutoroleRuleList({
    guildId,
    roles,
    rules,
    onChanged,
}: {
    guildId: string;
    roles: DashboardAutoroleRole[];
    rules: DashboardAutoroleRule[];
    onChanged: () => Promise<void>;
}) {
    const [busyRoleId, setBusyRoleId] = useState<string | undefined>();
    const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

    async function deleteRule(roleId: string): Promise<void> {
        setBusyRoleId(roleId);

        try {
            await deleteDashboardAutoroleRuleRouteData({
                data: {
                    guildId,
                    roleId,
                },
            });
            await onChanged();
        } finally {
            setBusyRoleId(undefined);
        }
    }

    return (
        <section className='p-4' aria-labelledby='autorole-rules-heading'>
            <h4 id='autorole-rules-heading' className='text-sm font-semibold text-white'>
                Current autoroles
            </h4>
            {rules.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No autoroles are configured yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[32rem] text-left text-sm'>
                        <thead className='border-b border-neutral-800 text-xs text-neutral-500 uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Role</th>
                                <th className='px-3 py-2 font-semibold'>Status</th>
                                <th className='px-3 py-2 font-semibold'>Updated</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-neutral-800'>
                            {rules.map((rule) => {
                                const role = rolesById.get(rule.roleId);
                                const label = role?.name ?? rule.name ?? rule.roleId;

                                return (
                                    <tr key={rule.roleId}>
                                        <td className='py-3 pr-3 align-top'>
                                            <p className='font-medium text-neutral-100'>{label}</p>
                                            <p className='mt-1 font-mono text-xs text-neutral-500'>{rule.roleId}</p>
                                        </td>
                                        <td className='px-3 py-3 align-top text-neutral-300'>
                                            {rule.enabled ? 'Enabled' : 'Disabled'}
                                        </td>
                                        <td className='px-3 py-3 align-top text-neutral-400'>
                                            {formatDateTime(rule.updatedAt)}
                                        </td>
                                        <td className='py-3 pl-3 text-right align-top'>
                                            <button
                                                type='button'
                                                onClick={() => void deleteRule(rule.roleId)}
                                                disabled={busyRoleId === rule.roleId}
                                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function DashboardAutoroleLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-32 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 space-y-3'>
                <div className='h-4 w-60 animate-pulse rounded bg-neutral-800' />
                <div className='h-10 w-full animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function formatRoleLabel(role: DashboardAutoroleRole): string {
    return `@${role.name}`;
}

function matchRoles(roles: DashboardAutoroleRole[], query: string): DashboardAutoroleRole[] {
    const normalizedQuery = normalizeRoleSearchText(query);

    if (!normalizedQuery) {
        return roles;
    }

    return roles
        .map((role, index) => ({
            role,
            index,
            score: scoreRoleMatch(role, normalizedQuery),
        }))
        .filter((match): match is { role: DashboardAutoroleRole; index: number; score: number } => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((match) => match.role);
}

function scoreRoleMatch(role: DashboardAutoroleRole, query: string): number {
    const tokens = query.split(/\s+/).filter(Boolean);
    const searchableValues = [role.name, role.id, formatRoleLabel(role)].map(normalizeRoleSearchText);
    let score = 0;

    for (const token of tokens) {
        const tokenScore = Math.max(...searchableValues.map((value) => scoreRoleToken(token, value)));

        if (tokenScore === 0) {
            return 0;
        }

        score += tokenScore;
    }

    return score;
}

function scoreRoleToken(token: string, value: string): number {
    if (!value) {
        return 0;
    }

    if (value === token) {
        return 100;
    }

    if (value.startsWith(token)) {
        return 80;
    }

    if (value.includes(token)) {
        return 60;
    }

    return isSubsequence(token, value) ? 30 : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
    let needleIndex = 0;

    for (const character of haystack) {
        if (character === needle[needleIndex]) {
            needleIndex += 1;
        }

        if (needleIndex === needle.length) {
            return true;
        }
    }

    return false;
}

function normalizeRoleSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/[^a-z0-9]+/g, ' ');
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Choose a role before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'not-found':
            return 'This server is no longer available.';
        default:
            return 'Could not save autorole settings.';
    }
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
