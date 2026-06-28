import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardTicketsSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardTicketPanelRouteData,
    readDashboardTicketsSettingsRouteData,
    updateDashboardTicketPanelRouteData,
} from '../server/dashboard-tickets-route-data.js';
import type { DashboardTicketPanel } from '../server/dashboard-tickets.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';

type TicketPanelDraft = {
    panelId: string;
    channelId: string;
    channelSearch: string;
    title: string;
    description: string;
    openEmoji: string;
    ticketCategoryId: string;
    staffRoleIds: string;
    ticketNameTemplate: string;
    maxOpenPerUser: number;
    privateTickets: boolean;
    enabled: boolean;
};

const defaultDraft: TicketPanelDraft = {
    panelId: '',
    channelId: '',
    channelSearch: '',
    title: 'Support tickets',
    description: 'React to open a ticket.',
    openEmoji: '🎫',
    ticketCategoryId: '',
    staffRoleIds: '',
    ticketNameTemplate: 'ticket-{number}',
    maxOpenPerUser: 1,
    privateTickets: true,
    enabled: true,
};

export function DashboardTicketsPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardTicketsSettingsQueryKey(guildId);
    const [draft, setDraft] = useState<TicketPanelDraft>(defaultDraft);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [status, setStatus] = useState<string | undefined>();
    const [busyPanelId, setBusyPanelId] = useState<string | undefined>();
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardTicketsSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') {
                throw new Error('Could not load ticket settings.');
            }

            return result;
        },
    });
    const selectedChannel = useMemo(
        () => settingsQuery.data?.textChannels.find((channel) => channel.id === draft.channelId),
        [draft.channelId, settingsQuery.data?.textChannels]
    );

    async function refreshSettings(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey });
    }

    async function publishPanel(): Promise<void> {
        setStatus(undefined);

        if (!draft.channelId.trim() || !draft.title.trim()) {
            setStatus('Choose a panel channel and title.');
            return;
        }

        setBusyPanelId(draft.panelId || 'new');

        try {
            const result = await updateDashboardTicketPanelRouteData({
                data: {
                    guildId,
                    ...(draft.panelId ? { panelId: draft.panelId } : {}),
                    channelId: draft.channelId,
                    title: draft.title,
                    description: draft.description,
                    openEmoji: draft.openEmoji,
                    ticketCategoryId: draft.ticketCategoryId,
                    staffRoleIds: parseRoleIds(draft.staffRoleIds),
                    ticketNameTemplate: draft.ticketNameTemplate,
                    maxOpenPerUser: draft.maxOpenPerUser,
                    privateTickets: draft.privateTickets,
                    enabled: draft.enabled,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setDraft(defaultDraft);
            setStatus(
                result.panel.config.syncStatus === 'stale' ? 'Published, but reaction setup failed.' : 'Published.'
            );
            await refreshSettings();
        } finally {
            setBusyPanelId(undefined);
        }
    }

    async function deletePanel(panel: DashboardTicketPanel): Promise<void> {
        setStatus(undefined);
        setBusyPanelId(panel.id);

        try {
            const result = await deleteDashboardTicketPanelRouteData({
                data: {
                    guildId,
                    panelId: panel.id,
                },
            });

            if (result.type !== 'deleted') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus('Removed.');
            await refreshSettings();
        } finally {
            setBusyPanelId(undefined);
        }
    }

    if (settingsQuery.isPending) {
        return <DashboardTicketsLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Tickets</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load ticket settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Tickets</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Publish reaction panels that open tracked support channels.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(20rem,30rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='tickets-editor-heading'>
                    <h4 id='tickets-editor-heading' className='text-sm font-semibold text-white'>
                        Panel editor
                    </h4>
                    <StructureStatus status={settingsQuery.data.structureReadStatus} />
                    <DashboardChannelPicker
                        label='Ticket panel channel'
                        channels={settingsQuery.data.textChannels}
                        hasError={settingsQuery.data.structureReadStatus === 'fetch-failed'}
                        isLoading={false}
                        isOpen={pickerOpen}
                        listboxId='ticket-panel-channel-options'
                        search={
                            selectedChannel && draft.channelSearch === draft.channelId
                                ? formatDashboardChannelLabel(selectedChannel)
                                : draft.channelSearch
                        }
                        selectedChannelId={draft.channelId}
                        onBlur={() => setPickerOpen(false)}
                        onFocus={() => setPickerOpen(true)}
                        onSearchChange={(channelSearch) => setDraft({ ...draft, channelSearch })}
                        onSelect={(channel) => {
                            setDraft({
                                ...draft,
                                channelId: channel.id,
                                channelSearch: channel.id,
                            });
                            setPickerOpen(false);
                        }}
                    />
                    <TextInput
                        label='Panel title'
                        value={draft.title}
                        onChange={(title) => setDraft({ ...draft, title })}
                    />
                    <TextInput
                        label='Panel description'
                        value={draft.description}
                        onChange={(description) => setDraft({ ...draft, description })}
                    />
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <TextInput
                            label='Open emoji'
                            value={draft.openEmoji}
                            onChange={(openEmoji) => setDraft({ ...draft, openEmoji })}
                        />
                        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                            <span>Max open per user</span>
                            <input
                                type='number'
                                min={1}
                                max={10}
                                value={draft.maxOpenPerUser}
                                onChange={(event) =>
                                    setDraft({
                                        ...draft,
                                        maxOpenPerUser: Number(event.currentTarget.value),
                                    })
                                }
                                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            />
                        </label>
                    </div>
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Ticket category</span>
                        <select
                            value={draft.ticketCategoryId}
                            onChange={(event) => setDraft({ ...draft, ticketCategoryId: event.currentTarget.value })}
                            className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                            <option value=''>No category</option>
                            {settingsQuery.data.categories.map((category) => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <TextInput
                        label='Ticket name template'
                        value={draft.ticketNameTemplate}
                        onChange={(ticketNameTemplate) => setDraft({ ...draft, ticketNameTemplate })}
                    />
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Staff role IDs</span>
                        <textarea
                            value={draft.staffRoleIds}
                            onChange={(event) => setDraft({ ...draft, staffRoleIds: event.currentTarget.value })}
                            rows={3}
                            className='w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder={settingsQuery.data.roles
                                .slice(0, 2)
                                .map((role) => role.id)
                                .join('\n')}
                        />
                    </label>
                    <div className='flex flex-wrap gap-2'>
                        <Toggle
                            label='Private tickets'
                            checked={draft.privateTickets}
                            onChange={(privateTickets) => setDraft({ ...draft, privateTickets })}
                        />
                        <Toggle
                            label='Enabled'
                            checked={draft.enabled}
                            onChange={(enabled) => setDraft({ ...draft, enabled })}
                        />
                    </div>
                    <button
                        type='button'
                        onClick={() => void publishPanel()}
                        disabled={Boolean(busyPanelId)}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Publish ticket panel
                    </button>
                    {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
                </section>
                <TicketPanelList
                    panels={settingsQuery.data.panels}
                    busyPanelId={busyPanelId}
                    onEdit={(panel) => setDraft(toDraft(panel))}
                    onDelete={(panel) => void deletePanel(panel)}
                />
            </div>
        </article>
    );
}

function TicketPanelList({
    panels,
    busyPanelId,
    onEdit,
    onDelete,
}: {
    panels: DashboardTicketPanel[];
    busyPanelId: string | undefined;
    onEdit: (panel: DashboardTicketPanel) => void;
    onDelete: (panel: DashboardTicketPanel) => void;
}) {
    return (
        <section className='p-4' aria-labelledby='ticket-panels-heading'>
            <h4 id='ticket-panels-heading' className='text-sm font-semibold text-white'>
                Published panels
            </h4>
            {panels.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No ticket panels are published yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[42rem] text-left text-sm'>
                        <thead className='border-b border-neutral-800 text-xs text-neutral-500 uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Panel</th>
                                <th className='px-3 py-2 font-semibold'>Channel</th>
                                <th className='px-3 py-2 font-semibold'>Open</th>
                                <th className='px-3 py-2 font-semibold'>Status</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-neutral-800'>
                            {panels.map((panel) => (
                                <tr key={panel.id}>
                                    <td className='py-3 pr-3 align-top font-medium text-neutral-100'>
                                        <p>{panel.title}</p>
                                        {panel.messageId ? (
                                            <p className='mt-1 font-mono text-xs text-neutral-500'>{panel.messageId}</p>
                                        ) : null}
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        <p>{panel.channelName ? `#${panel.channelName}` : panel.channelId}</p>
                                        <p className='mt-1 font-mono text-xs text-neutral-500'>{panel.channelId}</p>
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        {panel.config.openEmoji} / {panel.config.maxOpenPerUser}
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        {panel.enabled ? panel.config.syncStatus : 'disabled'}
                                    </td>
                                    <td className='py-3 pl-3 text-right align-top'>
                                        <div className='flex justify-end gap-2'>
                                            <button
                                                type='button'
                                                onClick={() => onEdit(panel)}
                                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                                                Edit
                                            </button>
                                            <button
                                                type='button'
                                                onClick={() => onDelete(panel)}
                                                disabled={busyPanelId === panel.id}
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

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
            <span>{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
            />
        </label>
    );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <label className='inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100'>
            <input
                type='checkbox'
                checked={checked}
                onChange={(event) => onChange(event.currentTarget.checked)}
                className='size-4 accent-sky-400'
            />
            {label}
        </label>
    );
}

function DashboardTicketsLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-24 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function StructureStatus({ status }: { status: string }) {
    if (status === 'available') {
        return null;
    }

    return (
        <p className='text-sm leading-6 text-rose-300'>
            {status === 'bot-token-missing'
                ? 'Set FLUXER_BOT_TOKEN for the web service to load ticket targets.'
                : 'Could not read server channels and roles.'}
        </p>
    );
}

function parseRoleIds(value: string): string[] {
    return [
        ...new Set(
            value
                .split(/[,\n]/u)
                .map((roleId) => roleId.trim())
                .filter(Boolean)
        ),
    ];
}

function toDraft(panel: DashboardTicketPanel): TicketPanelDraft {
    return {
        panelId: panel.id,
        channelId: panel.channelId,
        channelSearch: panel.channelId,
        title: panel.title,
        description: panel.config.description,
        openEmoji: panel.config.openEmoji,
        ticketCategoryId: panel.config.ticketCategoryId,
        staffRoleIds: panel.config.staffRoleIds.join('\n'),
        ticketNameTemplate: panel.config.ticketNameTemplate,
        maxOpenPerUser: panel.config.maxOpenPerUser,
        privateTickets: panel.config.privateTickets,
        enabled: panel.enabled,
    };
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Check the panel fields before publishing.';
        case 'bot-token-missing':
            return 'Set FLUXER_BOT_TOKEN for the web service before publishing ticket panels.';
        case 'message-send-error':
            return 'Could not publish the ticket panel message.';
        case 'auth-required':
            return 'Sign in again before changing ticket settings.';
        case 'not-found':
            return 'This server or ticket panel is no longer available.';
        default:
            return 'Could not save ticket settings.';
    }
}
