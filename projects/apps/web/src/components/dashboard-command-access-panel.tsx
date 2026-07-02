import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Search, ShieldAlert } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';

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
    DashboardCommandAccessResult,
    DashboardCommandAccessTargetType,
} from '../server/dashboard-command-access.server.js';
import { CommandAccessRuleTable } from './dashboard-command-access-rule-table.js';
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

type CommandAccessData = Extract<DashboardCommandAccessResult, { type: 'access' }>;
type SaveRuleInput = {
    targetType: DashboardCommandAccessTargetType;
    targetId: string;
    userIds: string[];
    roleIds: string[];
};
type DeleteRuleInput = {
    targetType: DashboardCommandAccessTargetType;
    targetId: string;
};

export function DashboardCommandAccessPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardCommandAccessQueryKey(guildId);
    const [status, setStatus] = useState<PanelStatus | undefined>();
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
    const saveMutation = useMutation({
        mutationFn: (input: SaveRuleInput) =>
            updateDashboardCommandAccessRouteData({
                data: {
                    guildId,
                    targetType: input.targetType,
                    targetId: input.targetId,
                    userIds: input.userIds,
                    roleIds: input.roleIds,
                },
            }),
        onMutate: async (input) => {
            await queryClient.cancelQueries({ queryKey });
            const previousAccess = queryClient.getQueryData<CommandAccessData>(queryKey);
            const optimisticRule = toOptimisticRule(input);

            if (previousAccess) {
                queryClient.setQueryData<CommandAccessData>(queryKey, upsertCommandAccessRule(previousAccess, optimisticRule));
            }

            setStatus({ tone: 'neutral', message: 'Saving command access...' });
            return { previousAccess };
        },
        onError: (_error, _input, context) => {
            restorePreviousAccess(context?.previousAccess);
            setStatus({ tone: 'error', message: 'Could not save command access.' });
        },
        onSuccess: async (result, _input, context) => {
            if (result.type !== 'updated') {
                restorePreviousAccess(context.previousAccess);
                setStatus(toMutationStatus(result.type));
                return;
            }

            queryClient.setQueryData<CommandAccessData>(queryKey, (currentAccess) =>
                currentAccess ? upsertCommandAccessRule(currentAccess, result.rule) : currentAccess
            );
            setStatus({ tone: 'success', message: 'Command access saved.' });
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey });
        },
    });
    const deleteMutation = useMutation({
        mutationFn: (input: DeleteRuleInput) =>
            deleteDashboardCommandAccessRouteData({
                data: {
                    guildId,
                    targetType: input.targetType,
                    targetId: input.targetId,
                },
            }),
        onMutate: async (input) => {
            await queryClient.cancelQueries({ queryKey });
            const previousAccess = queryClient.getQueryData<CommandAccessData>(queryKey);

            if (previousAccess) {
                queryClient.setQueryData<CommandAccessData>(queryKey, removeCommandAccessRule(previousAccess, input));
            }

            setStatus({ tone: 'neutral', message: 'Removing command access...' });
            return { previousAccess };
        },
        onError: (_error, _input, context) => {
            restorePreviousAccess(context?.previousAccess);
            setStatus({ tone: 'error', message: 'Could not remove command access.' });
        },
        onSuccess: async (result, _input, context) => {
            if (result.type !== 'deleted') {
                restorePreviousAccess(context.previousAccess);
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus({ tone: 'success', message: 'Command access removed.' });
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey });
        },
    });

    function restorePreviousAccess(previousAccess?: CommandAccessData): void {
        if (previousAccess) {
            queryClient.setQueryData<CommandAccessData>(queryKey, previousAccess);
        }
    }

    if (accessQuery.isPending) {
        return <DashboardCommandAccessLoading />;
    }

    if (accessQuery.isError) {
        return (
            <section className='rounded-[var(--dash-radius-surface)] border border-[var(--dash-danger)] bg-[var(--dash-danger-soft)] p-4'>
                <h3 className='text-lg font-semibold text-white'>Command access failed to load</h3>
                <p className='mt-2 text-sm leading-6 text-rose-100'>Could not load command access.</p>
            </section>
        );
    }

    const access = accessQuery.data;

    return (
        <section className='space-y-4' aria-labelledby='command-access-workflow-heading'>
            <h3 className='sr-only'>Command access</h3>
            <div className='grid gap-3 md:grid-cols-3'>
                <CommandAccessMetric label='Grantable targets' value={access.catalog.categories.length + access.catalog.commands.length} />
                <CommandAccessMetric label='Active grants' value={access.rules.length} />
                <CommandAccessMetric label='Known roles' value={access.roles.length} />
            </div>
            <div className='rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[var(--dash-surface)]'>
                <div className='border-b border-[var(--dash-border)] px-4 py-3'>
                    <h4 id='command-access-workflow-heading' className='text-base font-semibold text-[var(--dash-text)]'>
                        Command grant workflow
                    </h4>
                    <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                        Select a guarded category or command, choose trusted roles or users, then save. Dashboard access still requires Manage Server.
                    </p>
                </div>
                <CommandAccessEditor
                    catalog={access.catalog}
                    roles={access.roles}
                    roleReadStatus={access.roleReadStatus}
                    isBusy={saveMutation.isPending}
                    onSave={(input) => {
                        setStatus(undefined);
                        saveMutation.mutate(input);
                    }}
                />
            </div>
            <CommandAccessRuleTable
                catalog={access.catalog}
                roles={access.roles}
                rules={access.rules}
                busyTargetKey={deleteMutation.variables ? getRuleKey(deleteMutation.variables.targetType, deleteMutation.variables.targetId) : undefined}
                onDelete={(rule) => {
                    setStatus(undefined);
                    deleteMutation.mutate({
                        targetType: rule.targetType,
                        targetId: rule.targetId,
                    });
                }}
            />
            {status ? <StatusMessage status={status} /> : null}
        </section>
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
    const [targetSearch, setTargetSearch] = useState('');
    const [_isTargetPending, startTargetTransition] = useTransition();
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
    const effectiveTargetId = targetOptions.some((target) => target.id === form.targetId)
        ? form.targetId
        : (targetOptions[0]?.id ?? '');
    const selectedTarget = targetOptions.find((target) => target.id === effectiveTargetId);
    const filteredTargets = useMemo(
        () => filterCommandAccessTargets(targetOptions, targetSearch).slice(0, 12),
        [targetOptions, targetSearch]
    );
    const canSave =
        effectiveTargetId.trim().length > 0 && (parseIds(form.userIdsText).length > 0 || form.roleIds.length > 0);

    function updateTargetType(targetType: DashboardCommandAccessTargetType): void {
        startTargetTransition(() => {
            setTargetSearch('');
            setForm((current) => ({
                ...current,
                targetType,
                targetId: targetType === 'category' ? (catalog.categories[0]?.id ?? '') : (catalog.commands[0]?.id ?? ''),
            }));
        });
    }

    return (
        <section className='grid gap-0 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]' aria-labelledby='command-access-editor-heading'>
            <div className='border-b border-[var(--dash-border)] p-4 lg:border-r lg:border-b-0'>
                <div className='grid grid-cols-2 gap-2'>
                    <TargetTypeButton label='Category' selected={form.targetType === 'category'} onClick={() => updateTargetType('category')} />
                    <TargetTypeButton label='Command' selected={form.targetType === 'command'} onClick={() => updateTargetType('command')} />
                </div>
                <label className='mt-4 block space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                    <span>{form.targetType === 'category' ? 'Command category' : 'Command'}</span>
                    <select
                        value={effectiveTargetId}
                        onChange={(event) => {
                            const targetId = event.currentTarget.value;

                            setForm((current) => ({ ...current, targetId }));
                        }}
                        className='min-h-10 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-3 text-sm text-[var(--dash-text)] outline-none focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]'>
                        {targetOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                                {formatTargetLabel(option)}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='mt-4 flex min-h-10 items-center gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-3 text-sm text-[var(--dash-text-muted)] focus-within:border-[var(--dash-primary)] focus-within:ring-2 focus-within:ring-[var(--dash-primary-ring)]'>
                    <Search className='size-4 shrink-0' aria-hidden='true' />
                    <span className='sr-only'>Search command targets</span>
                    <input
                        value={targetSearch}
                        onChange={(event) => setTargetSearch(event.currentTarget.value)}
                        className='min-w-0 flex-1 bg-transparent text-sm text-[var(--dash-text)] outline-none placeholder:text-[var(--dash-text-subtle)]'
                        placeholder='Search targets'
                    />
                </label>
                <div className='mt-3 max-h-72 overflow-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)]'>
                    {filteredTargets.map((target) => (
                        <button
                            key={target.id}
                            type='button'
                            onClick={() => setForm((current) => ({ ...current, targetId: target.id }))}
                            className={
                                target.id === effectiveTargetId
                                    ? 'flex w-full items-start gap-2 border-l-2 border-[var(--dash-primary)] bg-[var(--dash-primary-soft)] px-3 py-2 text-left'
                                    : 'flex w-full items-start gap-2 border-l-2 border-transparent px-3 py-2 text-left transition hover:bg-[var(--dash-surface-raised)]'
                            }>
                            <KeyRound className='mt-0.5 size-4 shrink-0 text-[var(--dash-primary)]' aria-hidden='true' />
                            <span className='min-w-0'>
                                <span className='block truncate text-sm font-semibold text-[var(--dash-text)]'>
                                    {formatTargetLabel(target)}
                                </span>
                                <span className='block truncate font-mono text-xs text-[var(--dash-text-subtle)]'>
                                    {target.id}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            </div>
            <div className='p-4'>
                <h4 id='command-access-editor-heading' className='text-sm font-semibold text-[var(--dash-text)]'>
                    Add or update grant
                </h4>
                {selectedTarget ? (
                    <p className='mt-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-3 py-2 text-sm leading-6 text-[var(--dash-text-muted)]'>
                        {getTargetDescription(selectedTarget)}
                    </p>
                ) : null}
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
                            roleIds: current.roleIds.includes(roleId) ? current.roleIds : [...current.roleIds, roleId],
                        }))
                    }
                    onRemoveRole={(roleId) =>
                        setForm((current) => ({
                            ...current,
                            roleIds: current.roleIds.filter((currentRoleId) => currentRoleId !== roleId),
                        }))
                    }
                />
                <label className='mt-4 block space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                    <span>User IDs</span>
                    <textarea
                        value={form.userIdsText}
                        onChange={(event) => {
                            const userIdsText = event.currentTarget.value;

                            setForm((current) => ({ ...current, userIdsText }));
                        }}
                        rows={4}
                        spellCheck={false}
                        className='w-full resize-y rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-3 py-2 font-mono text-xs text-[var(--dash-text)] outline-none placeholder:text-[var(--dash-text-subtle)] focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]'
                        placeholder='One Fluxer/Discord user ID per line'
                    />
                </label>
                <button
                    type='button'
                    onClick={() =>
                        onSave({
                            targetType: form.targetType,
                            targetId: effectiveTargetId,
                            userIds: parseIds(form.userIdsText),
                            roleIds: form.roleIds,
                        })
                    }
                    disabled={isBusy || !canSave}
                    className='mt-4 inline-flex min-h-10 items-center gap-2 rounded-[var(--dash-radius-control)] bg-[var(--dash-primary)] px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 focus-visible:ring-2 focus-visible:ring-[var(--dash-primary-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                    <CheckCircle2 className='size-4' aria-hidden='true' />
                    {isBusy ? 'Saving...' : 'Save command grant'}
                </button>
            </div>
        </section>
    );
}

function DashboardCommandAccessLoading() {
    return (
        <section className='space-y-4' aria-label='Loading command access' aria-busy='true'>
            <div className='grid gap-3 md:grid-cols-3'>
                {Array.from({ length: 3 }, (_, index) => (
                    <div key={index} className='rounded-[var(--dash-radius-surface)] border border-[var(--dash-border)] bg-[var(--dash-surface)] p-4'>
                        <div className='h-3 w-24 animate-pulse rounded bg-neutral-800' />
                        <div className='mt-3 h-6 w-12 animate-pulse rounded bg-neutral-800' />
                    </div>
                ))}
            </div>
            <div className='rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[var(--dash-surface)] p-4'>
                <div className='h-5 w-40 animate-pulse rounded bg-neutral-800' />
                <div className='mt-4 h-44 animate-pulse rounded bg-neutral-800/70' />
            </div>
        </section>
    );
}

function TargetTypeButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
    return (
        <button
            type='button'
            onClick={onClick}
            aria-pressed={selected}
            className={`min-h-10 rounded-[var(--dash-radius-control)] border px-3 text-sm font-semibold transition ${
                selected
                    ? 'border-[var(--dash-primary)] bg-[var(--dash-primary)] text-neutral-950'
                    : 'border-[var(--dash-border)] text-[var(--dash-text-muted)] hover:border-[var(--dash-primary)] hover:text-[var(--dash-text)]'
            }`}>
            {label}
        </button>
    );
}

function StatusMessage({ status }: { status: PanelStatus }) {
    const colorClass = getStatusClassName(status.tone);
    const Icon = status.tone === 'success' ? CheckCircle2 : status.tone === 'error' ? ShieldAlert : KeyRound;

    return (
        <p className={`inline-flex items-center gap-2 rounded-[var(--dash-radius-surface)] border px-3 py-2 text-sm ${colorClass}`}>
            <Icon className='size-4' aria-hidden='true' />
            {status.message}
        </p>
    );
}

function CommandAccessMetric({ label, value }: { label: string; value: number }) {
    return (
        <div className='rounded-[var(--dash-radius-surface)] border border-[var(--dash-border)] bg-[var(--dash-surface)] p-4'>
            <p className='text-xs font-semibold tracking-wide text-[var(--dash-text-subtle)] uppercase'>{label}</p>
            <p className='mt-2 text-2xl font-semibold text-[var(--dash-text)]'>{value}</p>
        </div>
    );
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

function filterCommandAccessTargets(
    targets: Array<DashboardCommandAccessCatalog['categories'][number] | DashboardCommandAccessCatalog['commands'][number]>,
    query: string
) {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
        return targets;
    }

    return targets.filter((target) =>
        [target.id, formatTargetLabel(target), getTargetDescription(target)]
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery)
    );
}

function formatTargetLabel(
    target: DashboardCommandAccessCatalog['categories'][number] | DashboardCommandAccessCatalog['commands'][number]
): string {
    return 'commandName' in target ? `${target.categoryTitle}: ${target.commandName}` : target.title;
}

function getTargetDescription(
    target: DashboardCommandAccessCatalog['categories'][number] | DashboardCommandAccessCatalog['commands'][number]
): string {
    return 'description' in target ? target.description : `Grant all guarded commands in ${target.title}.`;
}

function toOptimisticRule(input: SaveRuleInput): DashboardCommandAccessRule {
    return {
        targetType: input.targetType,
        targetId: input.targetId,
        userIds: input.userIds,
        roleIds: input.roleIds,
        updatedAt: new Date().toISOString(),
    };
}

function upsertCommandAccessRule(access: CommandAccessData, rule: DashboardCommandAccessRule): CommandAccessData {
    const targetKey = getRuleKey(rule.targetType, rule.targetId);
    const nextRules = access.rules.filter((currentRule) => getRuleKey(currentRule.targetType, currentRule.targetId) !== targetKey);

    return {
        ...access,
        rules: [rule, ...nextRules],
    };
}

function removeCommandAccessRule(access: CommandAccessData, input: DeleteRuleInput): CommandAccessData {
    const targetKey = getRuleKey(input.targetType, input.targetId);

    return {
        ...access,
        rules: access.rules.filter((rule) => getRuleKey(rule.targetType, rule.targetId) !== targetKey),
    };
}

function getStatusClassName(tone: PanelStatus['tone']): string {
    if (tone === 'success') {
        return 'border-emerald-500/40 bg-[var(--dash-success-soft)] text-emerald-200';
    }

    if (tone === 'error') {
        return 'border-rose-400/40 bg-[var(--dash-danger-soft)] text-rose-200';
    }

    return 'border-[var(--dash-border)] bg-[var(--dash-surface)] text-[var(--dash-text-muted)]';
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
