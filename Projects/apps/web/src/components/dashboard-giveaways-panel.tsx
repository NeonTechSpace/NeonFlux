import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardGiveawaysSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    cancelDashboardGiveawayRouteData,
    closeDashboardGiveawayRouteData,
    publishDashboardGiveawayRouteData,
    readDashboardGiveawaysSettingsRouteData,
    rerollDashboardGiveawayRouteData,
} from '../server/dashboard-giveaways-route-data.js';
import type { DashboardGiveaway } from '../server/dashboard-giveaways.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';

type GiveawayDraft = {
    channelId: string;
    channelSearch: string;
    title: string;
    prize: string;
    description: string;
    entryEmoji: string;
    winnerCount: number;
    endsAt: string;
};

const defaultDraft: GiveawayDraft = {
    channelId: '',
    channelSearch: '',
    title: 'Community giveaway',
    prize: '',
    description: '',
    entryEmoji: '🎉',
    winnerCount: 1,
    endsAt: '',
};

export function DashboardGiveawaysPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardGiveawaysSettingsQueryKey(guildId);
    const [draft, setDraft] = useState<GiveawayDraft>(defaultDraft);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [status, setStatus] = useState<string | undefined>();
    const [busyGiveawayId, setBusyGiveawayId] = useState<string | undefined>();
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardGiveawaysSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') {
                throw new Error('Could not load giveaway settings.');
            }

            return result;
        },
    });
    const selectedChannel = useMemo(
        () => settingsQuery.data?.channels.find((channel) => channel.id === draft.channelId),
        [draft.channelId, settingsQuery.data?.channels]
    );

    async function refreshSettings(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey });
    }

    async function publishGiveaway(): Promise<void> {
        setStatus(undefined);

        if (!draft.channelId.trim() || !draft.title.trim() || !draft.prize.trim()) {
            setStatus('Choose a channel, title, and prize.');
            return;
        }

        setBusyGiveawayId('new');

        try {
            const result = await publishDashboardGiveawayRouteData({
                data: {
                    guildId,
                    channelId: draft.channelId,
                    title: draft.title,
                    prize: draft.prize,
                    description: draft.description,
                    entryEmoji: draft.entryEmoji,
                    winnerCount: draft.winnerCount,
                    endsAt: draft.endsAt,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setDraft(defaultDraft);
            setStatus(toSuccessStatus('Published', result.announcementStatus));
            await refreshSettings();
        } finally {
            setBusyGiveawayId(undefined);
        }
    }

    async function updateGiveaway(giveaway: DashboardGiveaway, action: 'close' | 'reroll' | 'cancel'): Promise<void> {
        setStatus(undefined);
        setBusyGiveawayId(`${action}:${giveaway.id}`);

        try {
            const routeData = {
                guildId,
                giveawayId: giveaway.id,
            };
            const result =
                action === 'close'
                    ? await closeDashboardGiveawayRouteData({ data: routeData })
                    : action === 'reroll'
                      ? await rerollDashboardGiveawayRouteData({ data: routeData })
                      : await cancelDashboardGiveawayRouteData({ data: routeData });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus(toSuccessStatus(action === 'reroll' ? 'Rerolled' : 'Updated', result.announcementStatus));
            await refreshSettings();
        } finally {
            setBusyGiveawayId(undefined);
        }
    }

    if (settingsQuery.isPending) {
        return <DashboardGiveawaysLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Giveaways</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load giveaway settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Giveaways</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Publish reaction-entry giveaways and draw winners from tracked entries.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(20rem,30rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='giveaway-editor-heading'>
                    <h4 id='giveaway-editor-heading' className='text-sm font-semibold text-white'>
                        Giveaway editor
                    </h4>
                    <StructureStatus status={settingsQuery.data.structureReadStatus} />
                    <DashboardChannelPicker
                        label='Giveaway channel'
                        channels={settingsQuery.data.channels}
                        hasError={settingsQuery.data.structureReadStatus === 'fetch-failed'}
                        isLoading={false}
                        isOpen={pickerOpen}
                        listboxId='giveaway-channel-options'
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
                    <TextInput label='Title' value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
                    <TextInput label='Prize' value={draft.prize} onChange={(prize) => setDraft({ ...draft, prize })} />
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Description</span>
                        <textarea
                            value={draft.description}
                            onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
                            rows={4}
                            className='w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='Optional giveaway details'
                        />
                    </label>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <TextInput
                            label='Entry emoji'
                            value={draft.entryEmoji}
                            onChange={(entryEmoji) => setDraft({ ...draft, entryEmoji })}
                        />
                        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                            <span>Winners</span>
                            <input
                                type='number'
                                min={1}
                                max={25}
                                value={draft.winnerCount}
                                onChange={(event) =>
                                    setDraft({ ...draft, winnerCount: Number(event.currentTarget.value) })
                                }
                                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            />
                        </label>
                    </div>
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Ends at</span>
                        <input
                            type='datetime-local'
                            value={draft.endsAt}
                            onChange={(event) => setDraft({ ...draft, endsAt: event.currentTarget.value })}
                            className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        />
                    </label>
                    <button
                        type='button'
                        onClick={() => void publishGiveaway()}
                        disabled={Boolean(busyGiveawayId)}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Publish giveaway
                    </button>
                    {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
                </section>
                <GiveawayList
                    giveaways={settingsQuery.data.giveaways}
                    busyGiveawayId={busyGiveawayId}
                    onAction={(giveaway, action) => void updateGiveaway(giveaway, action)}
                />
            </div>
        </article>
    );
}

function GiveawayList({
    giveaways,
    busyGiveawayId,
    onAction,
}: {
    giveaways: DashboardGiveaway[];
    busyGiveawayId: string | undefined;
    onAction: (giveaway: DashboardGiveaway, action: 'close' | 'reroll' | 'cancel') => void;
}) {
    return (
        <section className='p-4' aria-labelledby='giveaways-list-heading'>
            <h4 id='giveaways-list-heading' className='text-sm font-semibold text-white'>
                Published giveaways
            </h4>
            {giveaways.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No giveaways are published yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[50rem] text-left text-sm'>
                        <thead className='border-b border-neutral-800 text-xs text-neutral-500 uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Giveaway</th>
                                <th className='px-3 py-2 font-semibold'>Channel</th>
                                <th className='px-3 py-2 font-semibold'>Entries</th>
                                <th className='px-3 py-2 font-semibold'>Winners</th>
                                <th className='px-3 py-2 font-semibold'>Status</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-neutral-800'>
                            {giveaways.map((giveaway) => (
                                <tr key={giveaway.id}>
                                    <td className='py-3 pr-3 align-top font-medium text-neutral-100'>
                                        <p>{giveaway.title}</p>
                                        <p className='mt-1 text-xs text-neutral-500'>{giveaway.prize}</p>
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        <p>{giveaway.channelName ? `#${giveaway.channelName}` : giveaway.channelId}</p>
                                        <p className='mt-1 font-mono text-xs text-neutral-500'>{giveaway.channelId}</p>
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        {giveaway.entryEmoji} {giveaway.entryCount}
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>{formatWinners(giveaway)}</td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        <p>{formatGiveawayStatus(giveaway.status)}</p>
                                        {giveaway.syncStatus === 'stale' ? (
                                            <p className='mt-1 text-xs text-amber-200'>Reaction setup needs review.</p>
                                        ) : null}
                                    </td>
                                    <td className='py-3 pl-3 text-right align-top'>
                                        <GiveawayActions
                                            giveaway={giveaway}
                                            busyGiveawayId={busyGiveawayId}
                                            onAction={onAction}
                                        />
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

function GiveawayActions({
    giveaway,
    busyGiveawayId,
    onAction,
}: {
    giveaway: DashboardGiveaway;
    busyGiveawayId: string | undefined;
    onAction: (giveaway: DashboardGiveaway, action: 'close' | 'reroll' | 'cancel') => void;
}) {
    const isBusy = busyGiveawayId?.endsWith(giveaway.id) ?? false;

    if (giveaway.status === 'active') {
        return (
            <div className='flex justify-end gap-2'>
                <ActionButton label='Close' disabled={isBusy} onClick={() => onAction(giveaway, 'close')} />
                <ActionButton label='Cancel' disabled={isBusy} onClick={() => onAction(giveaway, 'cancel')} danger />
            </div>
        );
    }

    if (giveaway.status === 'closed') {
        return (
            <div className='flex justify-end gap-2'>
                <ActionButton label='Reroll' disabled={isBusy} onClick={() => onAction(giveaway, 'reroll')} />
            </div>
        );
    }

    return <span className='text-xs text-neutral-500'>No actions</span>;
}

function ActionButton({
    label,
    disabled,
    danger = false,
    onClick,
}: {
    label: string;
    disabled: boolean;
    danger?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type='button'
            onClick={onClick}
            disabled={disabled}
            className={`min-h-9 rounded-md border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:text-neutral-500 ${
                danger
                    ? 'border-neutral-700 text-neutral-100 hover:border-rose-300 hover:text-rose-200'
                    : 'border-neutral-700 text-neutral-100 hover:border-sky-400 hover:text-sky-200'
            }`}>
            {label}
        </button>
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

export function DashboardGiveawaysLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-28 animate-pulse rounded bg-neutral-800' />
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
                ? 'Set FLUXER_BOT_TOKEN for the web service before publishing giveaways.'
                : 'Could not read server channels.'}
        </p>
    );
}

function formatWinners(giveaway: DashboardGiveaway): string {
    if (giveaway.winners.length === 0) {
        return giveaway.status === 'closed' ? 'No winners' : `${giveaway.winnerCount} planned`;
    }

    return giveaway.winners.map((winner) => `<@${winner.userId}>`).join(', ');
}

function formatGiveawayStatus(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function toSuccessStatus(action: string, announcementStatus: 'sent' | 'failed' | 'not-needed'): string {
    if (announcementStatus === 'failed') {
        return `${action}, but the announcement could not be sent.`;
    }

    return `${action}.`;
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Check the giveaway fields before publishing.';
        case 'bot-token-missing':
            return 'Set FLUXER_BOT_TOKEN for the web service before managing giveaways.';
        case 'message-send-error':
            return 'Could not send the giveaway message.';
        case 'auth-required':
            return 'Sign in again before changing giveaway settings.';
        case 'not-found':
            return 'This server or giveaway is no longer available.';
        default:
            return 'Could not save giveaway settings.';
    }
}
