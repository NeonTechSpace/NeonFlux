import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardVcGeneratorSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardVcGeneratorRuleRouteData,
    readDashboardVcGeneratorSettingsRouteData,
    updateDashboardVcGeneratorRuleRouteData,
} from '../server/dashboard-vc-generator-route-data.js';
import type {
    DashboardVcGeneratorCategory,
    DashboardVcGeneratorChannel,
    DashboardVcGeneratorRule,
} from '../server/dashboard-vc-generator.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';

type RuleDraft = {
    sourceChannelId: string;
    sourceSearch: string;
    categoryId: string;
    panelChannelId: string;
    panelSearch: string;
    nameTemplate: string;
    enabled: boolean;
};

const defaultDraft: RuleDraft = {
    sourceChannelId: '',
    sourceSearch: '',
    categoryId: '',
    panelChannelId: '',
    panelSearch: '',
    nameTemplate: '{user} room',
    enabled: true,
};

export function DashboardVcGeneratorPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState<RuleDraft>(defaultDraft);
    const [openPicker, setOpenPicker] = useState<'source' | 'panel' | undefined>();
    const [status, setStatus] = useState<string | undefined>();
    const [busySourceChannelId, setBusySourceChannelId] = useState<string | undefined>();
    const queryKey = getDashboardVcGeneratorSettingsQueryKey(guildId);
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardVcGeneratorSettingsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'settings') {
                throw new Error('Could not load VC generator settings.');
            }

            return result;
        },
    });
    const selectedSourceChannel = useMemo(
        () => settingsQuery.data?.voiceChannels.find((channel) => channel.id === draft.sourceChannelId),
        [draft.sourceChannelId, settingsQuery.data?.voiceChannels]
    );
    const selectedPanelChannel = useMemo(
        () => settingsQuery.data?.textChannels.find((channel) => channel.id === draft.panelChannelId),
        [draft.panelChannelId, settingsQuery.data?.textChannels]
    );

    async function refreshSettings(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey });
    }

    async function saveRule(): Promise<void> {
        setStatus(undefined);

        if (!draft.sourceChannelId || !draft.nameTemplate.trim()) {
            setStatus('Choose a source voice channel and name template.');
            return;
        }

        setBusySourceChannelId(draft.sourceChannelId);

        try {
            const result = await updateDashboardVcGeneratorRuleRouteData({
                data: {
                    guildId,
                    sourceChannelId: draft.sourceChannelId,
                    nameTemplate: draft.nameTemplate,
                    ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
                    ...(draft.panelChannelId ? { panelChannelId: draft.panelChannelId } : {}),
                    enabled: draft.enabled,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setDraft(defaultDraft);
            setStatus('Saved.');
            await refreshSettings();
        } finally {
            setBusySourceChannelId(undefined);
        }
    }

    async function deleteRule(rule: DashboardVcGeneratorRule): Promise<void> {
        setStatus(undefined);
        setBusySourceChannelId(rule.sourceChannelId);

        try {
            const result = await deleteDashboardVcGeneratorRuleRouteData({
                data: {
                    guildId,
                    sourceChannelId: rule.sourceChannelId,
                },
            });

            if (result.type !== 'deleted') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus('Removed.');
            await refreshSettings();
        } finally {
            setBusySourceChannelId(undefined);
        }
    }

    if (settingsQuery.isPending) {
        return <DashboardVcGeneratorLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>VC generator</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load VC generator settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>VC generator</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Create temporary voice channels from source channels and publish a reaction control panel.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='vc-generator-editor-heading'>
                    <h4 id='vc-generator-editor-heading' className='text-sm font-semibold text-white'>
                        Rule editor
                    </h4>
                    <StructureStatus status={settingsQuery.data.structureReadStatus} />
                    <DashboardChannelPicker
                        label='Source voice channel'
                        channels={settingsQuery.data.voiceChannels}
                        hasError={settingsQuery.data.structureReadStatus === 'fetch-failed'}
                        isLoading={false}
                        isOpen={openPicker === 'source'}
                        listboxId='vc-generator-source-options'
                        search={
                            selectedSourceChannel && draft.sourceSearch === draft.sourceChannelId
                                ? formatVoiceChannelLabel(selectedSourceChannel)
                                : draft.sourceSearch
                        }
                        selectedChannelId={draft.sourceChannelId}
                        onBlur={() => setOpenPicker(undefined)}
                        onFocus={() => setOpenPicker('source')}
                        onSearchChange={(sourceSearch) => setDraft({ ...draft, sourceSearch })}
                        onSelect={(channel) => {
                            setDraft({
                                ...draft,
                                sourceChannelId: channel.id,
                                sourceSearch: channel.id,
                            });
                            setOpenPicker(undefined);
                        }}
                    />
                    <DashboardChannelPicker
                        label='Panel text channel'
                        channels={settingsQuery.data.textChannels}
                        hasError={settingsQuery.data.structureReadStatus === 'fetch-failed'}
                        isLoading={false}
                        isOpen={openPicker === 'panel'}
                        listboxId='vc-generator-panel-options'
                        search={
                            selectedPanelChannel && draft.panelSearch === draft.panelChannelId
                                ? formatDashboardChannelLabel(selectedPanelChannel)
                                : draft.panelSearch
                        }
                        selectedChannelId={draft.panelChannelId}
                        onBlur={() => setOpenPicker(undefined)}
                        onFocus={() => setOpenPicker('panel')}
                        onSearchChange={(panelSearch) => setDraft({ ...draft, panelSearch })}
                        onSelect={(channel) => {
                            setDraft({
                                ...draft,
                                panelChannelId: channel.id,
                                panelSearch: channel.id,
                            });
                            setOpenPicker(undefined);
                        }}
                    />
                    <CategorySelect
                        categories={settingsQuery.data.categories}
                        value={draft.categoryId}
                        onChange={(categoryId) => setDraft({ ...draft, categoryId })}
                    />
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Name template</span>
                        <input
                            value={draft.nameTemplate}
                            onChange={(event) => setDraft({ ...draft, nameTemplate: event.currentTarget.value })}
                            className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='{user} room'
                        />
                    </label>
                    <label className='inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100'>
                        <input
                            type='checkbox'
                            checked={draft.enabled}
                            onChange={(event) => setDraft({ ...draft, enabled: event.currentTarget.checked })}
                            className='size-4 accent-sky-400'
                        />
                        Enabled
                    </label>
                    <button
                        type='button'
                        onClick={() => void saveRule()}
                        disabled={Boolean(busySourceChannelId)}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Save generator rule
                    </button>
                    {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
                </section>
                <RuleList
                    rules={settingsQuery.data.rules}
                    busySourceChannelId={busySourceChannelId}
                    onEdit={(rule) => setDraft(toDraft(rule))}
                    onDelete={(rule) => void deleteRule(rule)}
                />
            </div>
        </article>
    );
}

function RuleList({
    rules,
    busySourceChannelId,
    onEdit,
    onDelete,
}: {
    rules: DashboardVcGeneratorRule[];
    busySourceChannelId: string | undefined;
    onEdit: (rule: DashboardVcGeneratorRule) => void;
    onDelete: (rule: DashboardVcGeneratorRule) => void;
}) {
    return (
        <section className='p-4' aria-labelledby='vc-generator-rules-heading'>
            <h4 id='vc-generator-rules-heading' className='text-sm font-semibold text-white'>
                Configured generators
            </h4>
            {rules.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No VC generator rules are configured yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[42rem] text-left text-sm'>
                        <thead className='border-b border-neutral-800 text-xs text-neutral-500 uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Source</th>
                                <th className='px-3 py-2 font-semibold'>Panel</th>
                                <th className='px-3 py-2 font-semibold'>Template</th>
                                <th className='px-3 py-2 font-semibold'>Status</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-neutral-800'>
                            {rules.map((rule) => (
                                <tr key={rule.id}>
                                    <td className='py-3 pr-3 align-top'>
                                        <p className='font-medium text-neutral-100'>
                                            {rule.sourceChannelName ?? rule.sourceChannelId}
                                        </p>
                                        <p className='mt-1 font-mono text-xs text-neutral-500'>
                                            {rule.sourceChannelId}
                                        </p>
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        <p>{rule.panelChannelName ?? rule.panelChannelId ?? 'No panel'}</p>
                                        {rule.panelMessageId ? (
                                            <p className='mt-1 font-mono text-xs text-neutral-500'>
                                                {rule.panelMessageId}
                                            </p>
                                        ) : null}
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>{rule.nameTemplate}</td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        {rule.enabled ? 'Enabled' : 'Disabled'}
                                    </td>
                                    <td className='py-3 pl-3 text-right align-top'>
                                        <div className='flex justify-end gap-2'>
                                            <button
                                                type='button'
                                                onClick={() => onEdit(rule)}
                                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                                                Edit
                                            </button>
                                            <button
                                                type='button'
                                                onClick={() => onDelete(rule)}
                                                disabled={busySourceChannelId === rule.sourceChannelId}
                                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                                Remove
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

export function DashboardVcGeneratorLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-32 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function CategorySelect({
    categories,
    value,
    onChange,
}: {
    categories: DashboardVcGeneratorCategory[];
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
            <span>Generated channel category</span>
            <select
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                <option value=''>Same as source channel</option>
                {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                        {category.name}
                    </option>
                ))}
            </select>
        </label>
    );
}

function StructureStatus({ status }: { status: string }) {
    if (status === 'available') {
        return null;
    }

    return (
        <p className='text-sm leading-6 text-rose-300'>
            {status === 'bot-token-missing'
                ? 'Set FLUXER_BOT_TOKEN for the web service to load channels and publish panels.'
                : 'Could not read server channels.'}
        </p>
    );
}

function toDraft(rule: DashboardVcGeneratorRule): RuleDraft {
    return {
        sourceChannelId: rule.sourceChannelId,
        sourceSearch: rule.sourceChannelId,
        categoryId: rule.categoryId ?? '',
        panelChannelId: rule.panelChannelId ?? '',
        panelSearch: rule.panelChannelId ?? '',
        nameTemplate: rule.nameTemplate,
        enabled: rule.enabled,
    };
}

function formatVoiceChannelLabel(channel: DashboardVcGeneratorChannel): string {
    return `#${channel.name}`;
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Check the source channel and name template before saving.';
        case 'bot-token-missing':
            return 'Set FLUXER_BOT_TOKEN for the web service before publishing a panel.';
        case 'message-send-error':
            return 'Could not send the control panel message.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'not-found':
            return 'This server or rule is no longer available.';
        default:
            return 'Could not save VC generator settings.';
    }
}
