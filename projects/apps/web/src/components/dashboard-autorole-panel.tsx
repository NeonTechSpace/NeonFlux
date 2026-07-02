import { useForm, useStore } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, LoaderCircle, Plus, Search, ShieldPlus, Trash2, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useDeferredValue, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { getDashboardAutoroleSettingsQueryKey } from '../dashboard-query-keys.js';
import { readDashboardAutoroleSettingsRouteData } from '../server/dashboard-autorole-route-data.js';
import type {
    DashboardAutoroleRole,
    DashboardAutoroleRule,
    DashboardAutoroleSettingsResult,
} from '../server/dashboard-autorole.server.js';
import {
    deleteAutoroleRuleWithOptimisticUpdate,
    formatDateTime,
    formatRoleLabel,
    matchRoles,
    parseAutoroleFormValue,
    saveAutoroleRuleWithOptimisticUpdate,
} from './dashboard-autorole-model.js';
import type { AutoroleFormValue } from './dashboard-autorole-model.js';

type AutoroleMutationStatus = { tone: 'success' | 'error' | 'pending'; message: string };

export function DashboardAutorolePanel({ guildId }: { guildId: string }) {
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

    if (settingsQuery.isPending) {
        return <DashboardAutoroleLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <DashboardAutoroleRegion>
                <DashboardAutoroleMessage
                    tone='error'
                    title='Could not load autoroles'
                    body='Reload the dashboard or sign in again before changing join-role automation.'
                />
            </DashboardAutoroleRegion>
        );
    }

    return <DashboardAutoroleWorkbench guildId={guildId} settings={settingsQuery.data} />;
}

function DashboardAutoroleWorkbench({
    guildId,
    settings,
}: {
    guildId: string;
    settings: Extract<DashboardAutoroleSettingsResult, { type: 'settings' }>;
}) {
    const enabledRules = settings.rules.filter((rule) => rule.enabled).length;
    const knownRoleIds = new Set(settings.roles.map((role) => role.id));
    const missingRoles = settings.rules.filter((rule) => !knownRoleIds.has(rule.roleId)).length;

    return (
        <DashboardAutoroleRegion>
            <div
                className='grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-[minmax(20rem,0.9fr)_minmax(30rem,1.1fr)]'
                data-dashboard-autorole-workbench>
                <div className='space-y-4'>
                    <AutoroleStatusRail
                        roleReadStatus={settings.roleReadStatus}
                        ruleCount={settings.rules.length}
                        enabledRules={enabledRules}
                        missingRoles={missingRoles}
                    />
                    <AutoroleRuleEditor
                        guildId={guildId}
                        roles={settings.roles}
                        roleReadStatus={settings.roleReadStatus}
                    />
                </div>
                <AutoroleRuleList guildId={guildId} roles={settings.roles} rules={settings.rules} />
            </div>
        </DashboardAutoroleRegion>
    );
}

function DashboardAutoroleRegion({ children }: { children: ReactNode }) {
    return <section className='space-y-4'>{children}</section>;
}

function AutoroleStatusRail({
    roleReadStatus,
    ruleCount,
    enabledRules,
    missingRoles,
}: {
    roleReadStatus: string;
    ruleCount: number;
    enabledRules: number;
    missingRoles: number;
}) {
    return (
        <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
            <AutoroleMetric label='Rules' value={ruleCount.toString()} tone='info' />
            <AutoroleMetric label='Enabled' value={enabledRules.toString()} tone='success' />
            <AutoroleMetric
                label='Needs review'
                value={missingRoles.toString()}
                tone={missingRoles > 0 ? 'warning' : 'info'}
            />
            {roleReadStatus === 'bot-token-missing' ? (
                <div className='col-span-3'>
                    <DashboardAutoroleMessage
                        tone='error'
                        title='Role data unavailable'
                        body='Set FLUXER_BOT_TOKEN for the web service before editing join-role automation.'
                    />
                </div>
            ) : null}
            {roleReadStatus === 'fetch-failed' ? (
                <div className='col-span-3'>
                    <DashboardAutoroleMessage
                        tone='error'
                        title='Could not read server roles'
                        body='Saved rules are still visible, but new role selection is disabled until Fluxer role data loads.'
                    />
                </div>
            ) : null}
        </div>
    );
}

function AutoroleMetric({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone: 'info' | 'success' | 'warning';
}) {
    const toneClassName =
        tone === 'success'
            ? 'bg-[var(--dash-success-soft)] text-emerald-200'
            : tone === 'warning'
              ? 'bg-[var(--dash-warning-soft)] text-amber-200'
              : 'bg-[var(--dash-info-soft)] text-sky-200';

    return (
        <div className={`rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] p-3 ${toneClassName}`}>
            <p className='text-[0.65rem] font-semibold tracking-wide uppercase opacity-80'>{label}</p>
            <p className='mt-1 text-xl font-semibold'>{value}</p>
        </div>
    );
}

function AutoroleRuleEditor({
    guildId,
    roles,
    roleReadStatus,
}: {
    guildId: string;
    roles: DashboardAutoroleRole[];
    roleReadStatus: string;
}) {
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [status, setStatus] = useState<AutoroleMutationStatus | undefined>();
    const deferredSearch = useDeferredValue(search);
    const defaultValues: AutoroleFormValue = {
        roleId: '',
        roleName: '',
        enabled: true,
    };
    const form = useForm({
        defaultValues,
        onSubmit: async ({ value, formApi }) => {
            setStatus({ tone: 'pending', message: 'Saving autorole...' });

            const parsed = parseAutoroleFormValue(value, roles);

            if (parsed.type === 'invalid') {
                setStatus({ tone: 'error', message: parsed.message });
                return;
            }

            const result = await saveAutoroleRuleWithOptimisticUpdate(queryClient, guildId, parsed.value);

            if (result.type === 'error') {
                setStatus({ tone: 'error', message: result.message });
                return;
            }

            formApi.reset();
            setSearch('');
            setStatus({ tone: 'success', message: 'Autorole saved.' });
        },
    });
    const selectedRoleId = useStore(form.store, (state) => state.values.roleId);
    const selectedRole = roles.find((role) => role.id === selectedRoleId);
    const matchedRoles = useMemo(() => matchRoles(roles, deferredSearch).slice(0, 10), [roles, deferredSearch]);
    const roleSearchValue = selectedRole && search === selectedRoleId ? formatRoleLabel(selectedRole) : search;
    const roleSelectionDisabled = roles.length === 0 || roleReadStatus !== 'available';

    return (
        <form
            className='rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[var(--dash-surface)] shadow-[var(--dash-shadow-surface)]'
            onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
            }}>
            <div className='border-b border-[var(--dash-border)] px-4 py-4'>
                <div className='flex items-center gap-3'>
                    <span className='grid size-9 place-items-center rounded-[var(--dash-radius-control)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]'>
                        <ShieldPlus className='size-4' aria-hidden='true' />
                    </span>
                    <div>
                        <h4 className='text-sm font-semibold text-[var(--dash-text)]'>Add join role</h4>
                        <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                            Pick a manageable role and save it locally.
                        </p>
                    </div>
                </div>
            </div>
            <div className='space-y-4 p-4'>
                <form.Field name='roleId'>
                    {(field) => <input type='hidden' name={field.name} value={field.state.value} readOnly />}
                </form.Field>
                <form.Field name='roleName'>
                    {(field) => <input type='hidden' name={field.name} value={field.state.value} readOnly />}
                </form.Field>
                <label className='block space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                    <span>Role</span>
                    <span className='relative block'>
                        <Search
                            className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--dash-text-subtle)]'
                            aria-hidden='true'
                        />
                        <input
                            value={roleSearchValue}
                            onBlur={() => setIsOpen(false)}
                            onChange={(event) => {
                                form.setFieldValue('roleId', '');
                                form.setFieldValue('roleName', '');
                                setSearch(event.currentTarget.value);
                                setIsOpen(true);
                            }}
                            onFocus={() => setIsOpen(true)}
                            className='min-h-10 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-9 text-base text-[var(--dash-text)] transition outline-none placeholder:text-[var(--dash-text-disabled)] focus:border-[var(--dash-primary)] focus:shadow-[var(--dash-shadow-focus)]'
                            autoComplete='off'
                            role='combobox'
                            aria-autocomplete='list'
                            aria-controls='autorole-role-options'
                            aria-expanded={isOpen}
                            placeholder='Search roles'
                            disabled={roleSelectionDisabled}
                        />
                    </span>
                </label>
                {isOpen && !roleSelectionDisabled ? (
                    <ul
                        id='autorole-role-options'
                        className='max-h-64 overflow-y-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] p-1'
                        role='listbox'>
                        {matchedRoles.length > 0 ? (
                            matchedRoles.map((role) => (
                                <li key={role.id} role='option' aria-selected={selectedRoleId === role.id}>
                                    <button
                                        type='button'
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => {
                                            form.setFieldValue('roleId', role.id);
                                            form.setFieldValue('roleName', role.name);
                                            setSearch(formatRoleLabel(role));
                                            setIsOpen(false);
                                        }}
                                        className='flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--dash-radius-control)] px-3 text-left text-sm text-[var(--dash-text)] transition outline-none hover:bg-[var(--dash-surface-raised)] focus:bg-[var(--dash-surface-raised)]'>
                                        <span className='min-w-0 truncate'>{formatRoleLabel(role)}</span>
                                        <span className='shrink-0 font-mono text-xs text-[var(--dash-text-subtle)]'>
                                            {role.id}
                                        </span>
                                    </button>
                                </li>
                            ))
                        ) : (
                            <li className='px-3 py-3 text-sm text-[var(--dash-text-subtle)]'>No matching roles.</li>
                        )}
                    </ul>
                ) : null}
                <form.Field name='enabled'>
                    {(field) => (
                        <label className='flex min-h-11 items-center justify-between gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-3 text-sm font-medium text-[var(--dash-text)]'>
                            <span>Enable immediately</span>
                            <input
                                type='checkbox'
                                checked={field.state.value}
                                onChange={(event) => field.handleChange(event.currentTarget.checked)}
                                className='size-4 accent-sky-400'
                            />
                        </label>
                    )}
                </form.Field>
                <form.Subscribe selector={(state) => ({ isSubmitting: state.isSubmitting })}>
                    {({ isSubmitting }) => (
                        <button
                            type='submit'
                            disabled={isSubmitting || !selectedRoleId}
                            className='inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[var(--dash-radius-control)] bg-[var(--dash-primary)] px-3 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[var(--dash-surface-raised)] disabled:text-[var(--dash-text-disabled)]'>
                            {isSubmitting ? (
                                <LoaderCircle className='size-4 animate-spin' aria-hidden='true' />
                            ) : (
                                <Plus className='size-4' aria-hidden='true' />
                            )}
                            Save autorole
                        </button>
                    )}
                </form.Subscribe>
                {status ? <AutoroleMutationStatusMessage status={status} /> : null}
            </div>
        </form>
    );
}

function AutoroleRuleList({
    guildId,
    roles,
    rules,
}: {
    guildId: string;
    roles: DashboardAutoroleRole[];
    rules: DashboardAutoroleRule[];
}) {
    const queryClient = useQueryClient();
    const [busyRoleId, setBusyRoleId] = useState<string | undefined>();
    const [status, setStatus] = useState<AutoroleMutationStatus | undefined>();
    const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

    async function deleteRule(roleId: string): Promise<void> {
        setBusyRoleId(roleId);
        setStatus({ tone: 'pending', message: 'Removing autorole...' });

        const result = await deleteAutoroleRuleWithOptimisticUpdate(queryClient, guildId, roleId);

        setBusyRoleId(undefined);

        if (result.type === 'error') {
            setStatus({ tone: 'error', message: result.message });
            return;
        }

        setStatus({ tone: 'success', message: 'Autorole removed.' });
    }

    return (
        <section
            className='min-w-0 overflow-hidden rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[var(--dash-surface)] shadow-[var(--dash-shadow-surface)]'
            data-dashboard-autorole-rule-list>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-[var(--dash-border)] px-4 py-4'>
                <div>
                    <h4 className='text-sm font-semibold text-[var(--dash-text)]'>Current autoroles</h4>
                    <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                        Rules run when a member joins the server.
                    </p>
                </div>
                {status ? <AutoroleMutationStatusMessage status={status} compact /> : null}
            </div>
            {rules.length === 0 ? (
                <div className='p-6'>
                    <DashboardAutoroleMessage
                        tone='neutral'
                        title='No autoroles configured'
                        body='Choose a role on the left to start a join-role rule.'
                    />
                </div>
            ) : (
                <div className='overflow-x-auto'>
                    <table className='w-full min-w-[38rem] text-left text-sm'>
                        <thead className='border-b border-[var(--dash-border)] text-xs text-[var(--dash-text-subtle)] uppercase'>
                            <tr>
                                <th className='py-3 pr-3 pl-4 font-semibold'>Role</th>
                                <th className='px-3 py-3 font-semibold'>State</th>
                                <th className='px-3 py-3 font-semibold'>Updated</th>
                                <th className='py-3 pr-4 pl-3 text-right font-semibold'>Action</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-[var(--dash-border)]'>
                            {rules.map((rule) => {
                                const role = rolesById.get(rule.roleId);
                                const label = role?.name ?? rule.name ?? rule.roleId;
                                const missingRole = !role;

                                return (
                                    <motion.tr
                                        key={rule.roleId}
                                        layout
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.16, ease: 'easeOut' }}
                                        className='align-top'>
                                        <td className='py-3 pr-3 pl-4'>
                                            <p className='font-medium text-[var(--dash-text)]'>
                                                {formatRoleLabel({ name: label })}
                                            </p>
                                            <p className='mt-1 font-mono text-xs text-[var(--dash-text-subtle)]'>
                                                {rule.roleId}
                                            </p>
                                            {missingRole ? (
                                                <p className='mt-1 text-xs font-medium text-amber-200'>
                                                    Role not readable right now
                                                </p>
                                            ) : null}
                                        </td>
                                        <td className='px-3 py-3'>
                                            <span
                                                className={
                                                    rule.enabled
                                                        ? 'inline-flex min-h-7 items-center gap-1 rounded-full bg-[var(--dash-success-soft)] px-2 text-xs font-semibold text-emerald-200'
                                                        : 'inline-flex min-h-7 items-center gap-1 rounded-full bg-[var(--dash-surface-muted)] px-2 text-xs font-semibold text-[var(--dash-text-muted)]'
                                                }>
                                                {rule.enabled ? (
                                                    <CheckCircle2 className='size-3.5' aria-hidden='true' />
                                                ) : (
                                                    <CircleSlash className='size-3.5' aria-hidden='true' />
                                                )}
                                                {rule.enabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </td>
                                        <td className='px-3 py-3 text-[var(--dash-text-muted)]'>
                                            {formatDateTime(rule.updatedAt)}
                                        </td>
                                        <td className='py-3 pr-4 pl-3 text-right'>
                                            <button
                                                type='button'
                                                onClick={() => void deleteRule(rule.roleId)}
                                                disabled={busyRoleId === rule.roleId}
                                                className='inline-flex min-h-9 items-center justify-center gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-3 text-sm font-semibold text-[var(--dash-text-muted)] transition hover:border-[var(--dash-danger)] hover:bg-[var(--dash-danger-soft)] hover:text-rose-200 focus-visible:border-[var(--dash-danger)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:text-[var(--dash-text-disabled)]'>
                                                {busyRoleId === rule.roleId ? (
                                                    <LoaderCircle className='size-4 animate-spin' aria-hidden='true' />
                                                ) : (
                                                    <Trash2 className='size-4' aria-hidden='true' />
                                                )}
                                                Remove
                                            </button>
                                        </td>
                                    </motion.tr>
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
        <DashboardAutoroleRegion>
            <div
                className='grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-[minmax(20rem,0.9fr)_minmax(30rem,1.1fr)]'
                aria-busy='true'>
                <div className='rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[var(--dash-surface)] p-4'>
                    <div className='h-5 w-32 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                    <div className='mt-4 space-y-3'>
                        <div className='h-4 w-52 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                        <div className='h-10 w-full animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                    </div>
                </div>
                <div className='rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[var(--dash-surface)] p-4'>
                    <div className='h-5 w-40 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                    <div className='mt-4 space-y-2'>
                        <div className='h-12 w-full animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                        <div className='h-12 w-full animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                    </div>
                </div>
            </div>
        </DashboardAutoroleRegion>
    );
}

function DashboardAutoroleMessage({ tone, title, body }: { tone: 'neutral' | 'error'; title: string; body: string }) {
    const toneClassName =
        tone === 'error'
            ? 'border-[var(--dash-danger)] bg-[var(--dash-danger-soft)] text-rose-100'
            : 'border-[var(--dash-border)] bg-[var(--dash-surface-muted)] text-[var(--dash-text)]';

    return (
        <div className={`rounded-[var(--dash-radius-panel)] border p-4 ${toneClassName}`}>
            <div className='flex gap-3'>
                {tone === 'error' ? (
                    <XCircle className='mt-0.5 size-4 shrink-0 text-rose-200' aria-hidden='true' />
                ) : (
                    <ShieldPlus className='mt-0.5 size-4 shrink-0 text-[var(--dash-primary)]' aria-hidden='true' />
                )}
                <div>
                    <p className='text-sm font-semibold'>{title}</p>
                    <p className='mt-1 text-sm leading-6 opacity-80'>{body}</p>
                </div>
            </div>
        </div>
    );
}

function AutoroleMutationStatusMessage({
    status,
    compact = false,
}: {
    status: AutoroleMutationStatus;
    compact?: boolean;
}) {
    const toneClassName =
        status.tone === 'success'
            ? 'bg-[var(--dash-success-soft)] text-emerald-200'
            : status.tone === 'pending'
              ? 'bg-[var(--dash-info-soft)] text-sky-200'
              : 'bg-[var(--dash-danger-soft)] text-rose-200';
    const Icon = status.tone === 'success' ? CheckCircle2 : status.tone === 'pending' ? LoaderCircle : XCircle;

    return (
        <p
            className={`inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold ${toneClassName} ${compact ? '' : 'w-full justify-center'}`}>
            <Icon className={status.tone === 'pending' ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden='true' />
            {status.message}
        </p>
    );
}
