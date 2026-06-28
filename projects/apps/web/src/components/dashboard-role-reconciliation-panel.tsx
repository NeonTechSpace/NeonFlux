import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getDashboardRoleReconciliationSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardRoleReconciliationSettingsRouteData,
    updateDashboardRoleReconciliationSettingsRouteData,
} from '../server/dashboard-role-reconciliation-route-data.js';
import type { DashboardRoleReconciliationSettings } from '../server/dashboard-role-reconciliation.server.js';

type RoleReconciliationDraft = Omit<DashboardRoleReconciliationSettings, 'updatedAt'>;

const defaultDraft: RoleReconciliationDraft = {
    enabled: true,
    restoreAutoroleRoles: true,
    restoreVerificationRoles: true,
    restoreReactionRoles: true,
    cleanupDeletedRoleReferences: true,
};

export function DashboardRoleReconciliationPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const [draftOverride, setDraftOverride] = useState<RoleReconciliationDraft | undefined>();
    const [status, setStatus] = useState<string | undefined>();
    const [isSaving, setIsSaving] = useState(false);
    const queryKey = getDashboardRoleReconciliationSettingsQueryKey(guildId);
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardRoleReconciliationSettingsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'settings') {
                throw new Error('Could not load role reconciliation settings.');
            }

            return result.settings;
        },
    });
    const baseDraft = settingsQuery.data ? toDraft(settingsQuery.data) : defaultDraft;
    const draft = draftOverride ?? baseDraft;

    function updateDraft(update: Partial<RoleReconciliationDraft>): void {
        setDraftOverride({ ...draft, ...update });
    }

    async function saveSettings(): Promise<void> {
        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await updateDashboardRoleReconciliationSettingsRouteData({
                data: {
                    guildId,
                    ...draft,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            queryClient.setQueryData(queryKey, result.settings);
            setDraftOverride(undefined);
            setStatus('Saved.');
            void queryClient.invalidateQueries({ queryKey });
        } finally {
            setIsSaving(false);
        }
    }

    if (settingsQuery.isPending) {
        return <DashboardRoleReconciliationLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Role reconciliation</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load role reconciliation settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                    <div>
                        <h3 className='text-lg font-semibold text-white'>Role reconciliation</h3>
                        <p className='mt-1 max-w-3xl text-sm leading-6 text-neutral-400'>
                            Repair missing feature roles after member role changes and clean deleted roles from feature
                            settings.
                        </p>
                    </div>
                    <SettingSwitch
                        label='Enabled'
                        checked={draft.enabled}
                        onChange={(enabled) => updateDraft({ enabled })}
                    />
                </div>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 lg:grid-cols-2 lg:divide-x lg:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='role-repair-heading'>
                    <div>
                        <h4 id='role-repair-heading' className='text-sm font-semibold text-white'>
                            Member role repair
                        </h4>
                        <p className='mt-1 text-sm leading-6 text-neutral-400'>
                            Re-apply roles owned by active role-based features when they disappear from a member.
                        </p>
                    </div>
                    <div className='space-y-3'>
                        <SettingSwitch
                            label='Autorole rules'
                            checked={draft.restoreAutoroleRoles}
                            disabled={!draft.enabled}
                            onChange={(restoreAutoroleRoles) => updateDraft({ restoreAutoroleRoles })}
                        />
                        <SettingSwitch
                            label='Verification roles'
                            checked={draft.restoreVerificationRoles}
                            disabled={!draft.enabled}
                            onChange={(restoreVerificationRoles) => updateDraft({ restoreVerificationRoles })}
                        />
                        <SettingSwitch
                            label='Reaction role choices'
                            checked={draft.restoreReactionRoles}
                            disabled={!draft.enabled}
                            onChange={(restoreReactionRoles) => updateDraft({ restoreReactionRoles })}
                        />
                    </div>
                </section>
                <section className='space-y-4 p-4' aria-labelledby='role-cleanup-heading'>
                    <div>
                        <h4 id='role-cleanup-heading' className='text-sm font-semibold text-white'>
                            Deleted role cleanup
                        </h4>
                        <p className='mt-1 text-sm leading-6 text-neutral-400'>
                            Remove deleted role IDs from role-backed feature settings so stale references do not keep
                            failing.
                        </p>
                    </div>
                    <SettingSwitch
                        label='Clean deleted role references'
                        checked={draft.cleanupDeletedRoleReferences}
                        disabled={!draft.enabled}
                        onChange={(cleanupDeletedRoleReferences) => updateDraft({ cleanupDeletedRoleReferences })}
                    />
                </section>
            </div>
            <div className='flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3'>
                <p className='text-sm text-neutral-400'>
                    {settingsQuery.data.updatedAt
                        ? `Last saved ${formatDateTime(settingsQuery.data.updatedAt)}`
                        : 'Using default enabled behavior.'}
                </p>
                <div className='flex items-center gap-3'>
                    {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
                    <button
                        type='button'
                        onClick={() => void saveSettings()}
                        disabled={isSaving}
                        className='min-h-10 rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Save role reconciliation
                    </button>
                </div>
            </div>
        </article>
    );
}

function DashboardRoleReconciliationLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-44 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                <div className='h-16 animate-pulse rounded bg-neutral-800' />
                <div className='h-16 animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function SettingSwitch({
    label,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className='flex min-h-10 items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm font-medium text-neutral-200'>
            <span>{label}</span>
            <input
                type='checkbox'
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.currentTarget.checked)}
                className='size-4 accent-sky-400 disabled:cursor-not-allowed disabled:opacity-50'
            />
        </label>
    );
}

function toDraft(settings: DashboardRoleReconciliationSettings): RoleReconciliationDraft {
    return {
        enabled: settings.enabled,
        restoreAutoroleRoles: settings.restoreAutoroleRoles,
        restoreVerificationRoles: settings.restoreVerificationRoles,
        restoreReactionRoles: settings.restoreReactionRoles,
        cleanupDeletedRoleReferences: settings.cleanupDeletedRoleReferences,
    };
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Check the role reconciliation settings before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'not-found':
            return 'This server is no longer available.';
        default:
            return 'Could not save role reconciliation settings.';
    }
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
