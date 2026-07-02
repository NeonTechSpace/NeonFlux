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
import { DashboardEntitySelector } from './dashboard-entity-selector.js';
import type { DashboardEntityOption } from './dashboard-entity-selector.js';

type TicketPanelDraft = {
    panelId: string;
    channelId: string;
    channelSearch: string;
    title: string;
    description: string;
    openEmoji: string;
    ticketCategoryId: string;
    staffRoleIds: string[];
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
    staffRoleIds: [],
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
    const roleOptions = useMemo<DashboardEntityOption[]>(
        () =>
            settingsQuery.data?.roles.map((role) => ({
                id: role.id,
                name: role.name,
                color: role.color,
            })) ?? [],
        [settingsQuery.data?.roles]
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
                    staffRoleIds: draft.staffRoleIds,
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
            <article className='dashboard-glass-panel p-5'>
                <h3 className='text-lg font-semibold text-[var(--dash-text)]'>Tickets</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load ticket settings.</p>
            </article>
        );
    }

    return (
        <article className='dashboard-glass-panel overflow-hidden'>
            <div className='border-b border-[var(--dash-border)] px-5 py-4'>
                <h3 className='text-xl font-semibold text-[var(--dash-text)]'>Tickets</h3>
                <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>Reaction panels for private support channels.</p>
            </div>
            <div className='grid gap-0 divide-y divide-[var(--dash-border)] xl:grid-cols-[minmax(22rem,32rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-5' aria-labelledby='tickets-editor-heading'>
                    <h4 id='tickets-editor-heading' className='text-base font-semibold text-[var(--dash-text)]'>
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
                        <label className='dashboard-label block'>
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
                                className='dashboard-field mt-2'
                            />
                        </label>
                    </div>
                    <label className='dashboard-label block'>
                        <span>Ticket category</span>
                        <select
                            value={draft.ticketCategoryId}
                            onChange={(event) => setDraft({ ...draft, ticketCategoryId: event.currentTarget.value })}
                            className='dashboard-field mt-2'>
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
                    <DashboardEntitySelector
                        kind='role'
                        label='Staff roles'
                        options={roleOptions}
                        selectedIds={draft.staffRoleIds}
                        unavailableText={
                            settingsQuery.data.structureReadStatus === 'available'
                                ? undefined
                                : toStructureStatusMessage(settingsQuery.data.structureReadStatus)
                        }
                        onSelectedIdsChange={(staffRoleIds) => setDraft({ ...draft, staffRoleIds })}
                    />
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
                        className='dashboard-primary-button min-h-10 w-full px-4 text-sm'>
                        Publish ticket panel
                    </button>
                    {status ? <p className='text-sm text-[var(--dash-text-muted)]'>{status}</p> : null}
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
        <section className='p-5' aria-labelledby='ticket-panels-heading'>
            <h4 id='ticket-panels-heading' className='text-base font-semibold text-[var(--dash-text)]'>
                Published panels
            </h4>
            {panels.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-[var(--dash-text-muted)]'>No ticket panels are published yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[42rem] text-left text-sm'>
                        <thead className='border-b border-[var(--dash-border)] text-xs text-[var(--dash-text-subtle)] uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Panel</th>
                                <th className='px-3 py-2 font-semibold'>Channel</th>
                                <th className='px-3 py-2 font-semibold'>Open</th>
                                <th className='px-3 py-2 font-semibold'>Status</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-[var(--dash-border)]'>
                            {panels.map((panel) => (
                                <tr key={panel.id}>
                                    <td className='py-3 pr-3 align-top font-medium text-[var(--dash-text)]'>
                                        <p>{panel.title}</p>
                                        {panel.messageId ? (
                                            <p className='mt-1 font-mono text-xs text-[var(--dash-text-subtle)]'>{panel.messageId}</p>
                                        ) : null}
                                    </td>
                                    <td className='px-3 py-3 align-top text-[var(--dash-text-muted)]'>
                                        <p>{panel.channelName ? `#${panel.channelName}` : panel.channelId}</p>
                                        <p className='mt-1 font-mono text-xs text-[var(--dash-text-subtle)]'>{panel.channelId}</p>
                                    </td>
                                    <td className='px-3 py-3 align-top text-[var(--dash-text-muted)]'>
                                        {panel.config.openEmoji} / {panel.config.maxOpenPerUser}
                                    </td>
                                    <td className='px-3 py-3 align-top text-[var(--dash-text-muted)]'>
                                        {panel.enabled ? panel.config.syncStatus : 'disabled'}
                                    </td>
                                    <td className='py-3 pl-3 text-right align-top'>
                                        <div className='flex justify-end gap-2'>
                                            <button
                                                type='button'
                                                onClick={() => onEdit(panel)}
                                                className='dashboard-secondary-button min-h-9 px-3 text-sm'>
                                                Edit
                                            </button>
                                            <button
                                                type='button'
                                                onClick={() => onDelete(panel)}
                                                disabled={busyPanelId === panel.id}
                                                className='dashboard-danger-button min-h-9 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60'>
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
        <label className='dashboard-label block'>
            <span>{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className='dashboard-field mt-2'
            />
        </label>
    );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <label className='dashboard-secondary-button inline-flex min-h-10 items-center gap-2 px-3 text-sm'>
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
        <article className='dashboard-glass-panel p-5' aria-busy='true'>
            <div className='h-5 w-24 animate-pulse rounded bg-[var(--dash-primary-soft)]' />
            <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                <div className='h-10 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                <div className='h-10 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
            </div>
        </article>
    );
}

function StructureStatus({ status }: { status: string }) {
    if (status === 'available') {
        return null;
    }

    return <p className='text-sm leading-6 text-rose-300'>{toStructureStatusMessage(status)}</p>;
}

function toStructureStatusMessage(status: string): string {
    return status === 'bot-token-missing'
        ? 'Set FLUXER_BOT_TOKEN for the web service to load ticket targets.'
        : 'Could not read server channels and roles.';
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
        staffRoleIds: panel.config.staffRoleIds,
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
