import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardLoggingSettingsQueryKey, getDashboardPostingChannelsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardLoggingDestinationRouteData,
    readDashboardLoggingSettingsRouteData,
    updateDashboardLoggingDestinationRouteData,
} from '../server/dashboard-logging-route-data.js';
import { readDashboardPostingChannelsRouteData } from '../server/dashboard-guild-route-data.js';
import type { DashboardLoggingDestination, DashboardLoggingEventGroup } from '../server/dashboard-logging.server.js';
import type { DashboardPostingChannel } from '../server/dashboard-posting.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';

export function DashboardLoggingDestinationsPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const settingsQuery = useQuery({
        queryKey: getDashboardLoggingSettingsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardLoggingSettingsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'settings') {
                throw new Error('Could not load logging settings.');
            }

            return result;
        },
    });
    const channelsQuery = useQuery({
        queryKey: getDashboardPostingChannelsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardPostingChannelsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'channels') {
                throw new Error('Could not load logging channels.');
            }

            return result.channels;
        },
    });
    const destinationsByGroup = useMemo(() => {
        const destinations = new Map<string, DashboardLoggingDestination>();

        for (const destination of settingsQuery.data?.destinations ?? []) {
            destinations.set(destination.eventGroup, destination);
        }

        return destinations;
    }, [settingsQuery.data?.destinations]);

    async function invalidateLoggingSettings(): Promise<void> {
        await queryClient.invalidateQueries({
            queryKey: getDashboardLoggingSettingsQueryKey(guildId),
        });
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-lg font-semibold text-white'>Server event destinations</h2>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>
                        Route Discord-style server events to channels by category.
                    </p>
                </div>
                {settingsQuery.isFetching || channelsQuery.isFetching ? (
                    <span className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300'>
                        Loading
                    </span>
                ) : null}
            </div>

            {settingsQuery.isError ? (
                <p className='mt-4 text-sm text-rose-300'>Could not load logging destinations.</p>
            ) : null}
            {channelsQuery.isError ? <p className='mt-4 text-sm text-rose-300'>Could not load channels.</p> : null}

            <div className='mt-4 divide-y divide-neutral-800 rounded-md border border-neutral-800'>
                {(settingsQuery.data?.eventGroups ?? []).map((eventGroup) => (
                    <LoggingDestinationRow
                        key={`${eventGroup.id}:${destinationsByGroup.get(eventGroup.id)?.channelId ?? 'none'}:${
                            destinationsByGroup.get(eventGroup.id)?.enabled ?? true
                        }`}
                        guildId={guildId}
                        eventGroup={eventGroup}
                        destination={destinationsByGroup.get(eventGroup.id)}
                        channels={channelsQuery.data ?? []}
                        channelsLoading={channelsQuery.isPending}
                        channelsError={channelsQuery.isError}
                        onChanged={invalidateLoggingSettings}
                    />
                ))}
                {settingsQuery.isPending ? (
                    <div className='space-y-3 p-4' aria-label='Loading logging destinations'>
                        <div className='h-4 w-52 animate-pulse rounded bg-neutral-800' />
                        <div className='h-4 w-72 animate-pulse rounded bg-neutral-800' />
                        <div className='h-10 w-full animate-pulse rounded bg-neutral-800' />
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function LoggingDestinationRow({
    guildId,
    eventGroup,
    destination,
    channels,
    channelsLoading,
    channelsError,
    onChanged,
}: {
    guildId: string;
    eventGroup: DashboardLoggingEventGroup;
    destination?: DashboardLoggingDestination;
    channels: DashboardPostingChannel[];
    channelsLoading: boolean;
    channelsError: boolean;
    onChanged: () => Promise<void>;
}) {
    const [selectedChannelId, setSelectedChannelId] = useState(destination?.channelId ?? '');
    const [enabled, setEnabled] = useState(destination?.enabled ?? true);
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [status, setStatus] = useState<string | undefined>();
    const [isSaving, setIsSaving] = useState(false);
    const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);
    const displaySearch =
        selectedChannel && search === selectedChannelId ? formatDashboardChannelLabel(selectedChannel) : search;

    async function saveDestination(): Promise<void> {
        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await updateDashboardLoggingDestinationRouteData({
                data: {
                    guildId,
                    eventGroup: eventGroup.id,
                    channelId: selectedChannelId,
                    enabled,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus('Saved.');
            await onChanged();
        } finally {
            setIsSaving(false);
        }
    }

    async function clearDestination(): Promise<void> {
        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await deleteDashboardLoggingDestinationRouteData({
                data: {
                    guildId,
                    eventGroup: eventGroup.id,
                },
            });

            if (result.type !== 'deleted') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setSelectedChannelId('');
            setStatus('Cleared.');
            await onChanged();
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <section className='grid gap-4 p-4 lg:grid-cols-[minmax(12rem,18rem)_minmax(16rem,1fr)_auto] lg:items-start'>
            <div className='min-w-0'>
                <h3 className='font-semibold text-white'>{eventGroup.label}</h3>
                <p className='mt-1 text-sm leading-5 text-neutral-400'>{eventGroup.description}</p>
                {destination ? (
                    <p className='mt-2 text-xs text-neutral-500'>Saved {formatDateTime(destination.updatedAt)}</p>
                ) : null}
            </div>

            <DashboardChannelPicker
                channels={channels}
                hasError={channelsError}
                isLoading={channelsLoading}
                isOpen={isOpen}
                listboxId={`logging-${eventGroup.id}-channel-options`}
                search={displaySearch}
                selectedChannelId={selectedChannelId}
                onBlur={() => setIsOpen(false)}
                onFocus={() => setIsOpen(true)}
                onSearchChange={(value) => {
                    setSearch(value);
                    setIsOpen(true);
                }}
                onSelect={(channel) => {
                    setSelectedChannelId(channel.id);
                    setSearch(formatDashboardChannelLabel(channel));
                    setIsOpen(false);
                }}
            />

            <div className='flex flex-wrap items-center gap-2 lg:justify-end'>
                <label className='inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-medium text-neutral-200'>
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
                    onClick={() => void saveDestination()}
                    disabled={isSaving || !selectedChannelId}
                    className='min-h-10 rounded-md bg-sky-400 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                    Save
                </button>
                {destination ? (
                    <button
                        type='button'
                        onClick={() => void clearDestination()}
                        disabled={isSaving}
                        className='min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        Clear
                    </button>
                ) : null}
                {status ? <p className='basis-full text-right text-xs text-neutral-400'>{status}</p> : null}
            </div>
        </section>
    );
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Choose a channel before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'not-found':
            return 'This server is no longer available.';
        default:
            return 'Could not save logging settings.';
    }
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
