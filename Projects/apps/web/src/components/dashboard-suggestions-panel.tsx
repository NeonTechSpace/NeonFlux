import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardSuggestionsSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardSuggestionBoardRouteData,
    readDashboardSuggestionsSettingsRouteData,
    updateDashboardSuggestionBoardRouteData,
} from '../server/dashboard-suggestions-route-data.js';
import type { DashboardSuggestionBoard } from '../server/dashboard-suggestions.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';

type BoardDraft = {
    name: string;
    channelId: string;
    channelSearch: string;
    enabled: boolean;
};

const defaultDraft: BoardDraft = {
    name: 'ideas',
    channelId: '',
    channelSearch: '',
    enabled: true,
};

export function DashboardSuggestionsPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardSuggestionsSettingsQueryKey(guildId);
    const [draft, setDraft] = useState<BoardDraft>(defaultDraft);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [status, setStatus] = useState<string | undefined>();
    const [busyBoardName, setBusyBoardName] = useState<string | undefined>();
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardSuggestionsSettingsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'settings') {
                throw new Error('Could not load suggestion board settings.');
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

    async function saveBoard(): Promise<void> {
        setStatus(undefined);

        if (!draft.name.trim() || !draft.channelId) {
            setStatus('Choose a board name and channel.');
            return;
        }

        setBusyBoardName(draft.name);

        try {
            const result = await updateDashboardSuggestionBoardRouteData({
                data: {
                    guildId,
                    name: draft.name,
                    channelId: draft.channelId,
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
            setBusyBoardName(undefined);
        }
    }

    async function deleteBoard(board: DashboardSuggestionBoard): Promise<void> {
        setStatus(undefined);
        setBusyBoardName(board.name);

        try {
            const result = await deleteDashboardSuggestionBoardRouteData({
                data: {
                    guildId,
                    name: board.name,
                },
            });

            if (result.type !== 'deleted') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus('Removed.');
            await refreshSettings();
        } finally {
            setBusyBoardName(undefined);
        }
    }

    if (settingsQuery.isPending) {
        return <DashboardSuggestionsLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Suggestions</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load suggestion board settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Suggestions</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Configure where public suggestion commands post submitted ideas.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='suggestions-editor-heading'>
                    <h4 id='suggestions-editor-heading' className='text-sm font-semibold text-white'>
                        Board editor
                    </h4>
                    <StructureStatus status={settingsQuery.data.structureReadStatus} />
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Board name</span>
                        <input
                            value={draft.name}
                            onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                            className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='ideas'
                        />
                    </label>
                    <DashboardChannelPicker
                        label='Suggestion channel'
                        channels={settingsQuery.data.channels}
                        hasError={settingsQuery.data.structureReadStatus === 'fetch-failed'}
                        isLoading={false}
                        isOpen={pickerOpen}
                        listboxId='suggestions-channel-options'
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
                        onClick={() => void saveBoard()}
                        disabled={Boolean(busyBoardName)}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Save suggestion board
                    </button>
                    {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
                </section>
                <BoardList
                    boards={settingsQuery.data.boards}
                    busyBoardName={busyBoardName}
                    onEdit={(board) => setDraft(toDraft(board))}
                    onDelete={(board) => void deleteBoard(board)}
                />
            </div>
        </article>
    );
}

function BoardList({
    boards,
    busyBoardName,
    onEdit,
    onDelete,
}: {
    boards: DashboardSuggestionBoard[];
    busyBoardName: string | undefined;
    onEdit: (board: DashboardSuggestionBoard) => void;
    onDelete: (board: DashboardSuggestionBoard) => void;
}) {
    return (
        <section className='p-4' aria-labelledby='suggestions-boards-heading'>
            <h4 id='suggestions-boards-heading' className='text-sm font-semibold text-white'>
                Configured boards
            </h4>
            {boards.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No suggestion boards are configured yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[34rem] text-left text-sm'>
                        <thead className='border-b border-neutral-800 text-xs text-neutral-500 uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Board</th>
                                <th className='px-3 py-2 font-semibold'>Channel</th>
                                <th className='px-3 py-2 font-semibold'>Status</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-neutral-800'>
                            {boards.map((board) => (
                                <tr key={board.id}>
                                    <td className='py-3 pr-3 align-top font-medium text-neutral-100'>{board.name}</td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        <p>{board.channelName ? `#${board.channelName}` : board.channelId}</p>
                                        <p className='mt-1 font-mono text-xs text-neutral-500'>{board.channelId}</p>
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        {board.enabled ? 'Enabled' : 'Disabled'}
                                    </td>
                                    <td className='py-3 pl-3 text-right align-top'>
                                        <div className='flex justify-end gap-2'>
                                            <button
                                                type='button'
                                                onClick={() => onEdit(board)}
                                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                                                Edit
                                            </button>
                                            <button
                                                type='button'
                                                onClick={() => onDelete(board)}
                                                disabled={busyBoardName === board.name}
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

export function DashboardSuggestionsLoading() {
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
                ? 'Set FLUXER_BOT_TOKEN for the web service to load channels.'
                : 'Could not read server channels.'}
        </p>
    );
}

function toDraft(board: DashboardSuggestionBoard): BoardDraft {
    return {
        name: board.name,
        channelId: board.channelId,
        channelSearch: board.channelId,
        enabled: board.enabled,
    };
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Check the board name and channel before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'not-found':
            return 'This server or board is no longer available.';
        default:
            return 'Could not save suggestion board settings.';
    }
}
