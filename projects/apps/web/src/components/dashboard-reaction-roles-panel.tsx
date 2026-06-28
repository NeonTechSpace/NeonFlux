import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getDashboardAuditEventsQueryKey, getDashboardReactionRolesSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardReactionRoleMessageRouteData,
    readDashboardReactionRolesSettingsRouteData,
} from '../server/dashboard-reaction-roles-route-data.js';
import type {
    DashboardReactionRoleEmoji,
    DashboardReactionRoleMessage,
} from '../server/dashboard-reaction-roles.server.js';
import { ReactionRoleEditor } from './dashboard-reaction-role-editor.js';

type ReactionRolePanelView =
    | { type: 'overview' }
    | { type: 'create' }
    | { type: 'edit'; message: DashboardReactionRoleMessage };
type PanelMessage = { type: 'success' | 'warning' | 'error'; text: string };

const commonEmojis: DashboardReactionRoleEmoji[] = [
    '✅',
    '❌',
    '⭐',
    '🔥',
    '🎮',
    '🎨',
    '📢',
    '📌',
    '💬',
    '🔔',
    '🟢',
    '🔵',
    '🟣',
    '🟡',
    '🧡',
    '❤️',
].map((emoji) => ({
    key: emoji,
    label: emoji,
    name: emoji,
    custom: false,
    animated: false,
}));

export function DashboardReactionRolesPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const [view, setView] = useState<ReactionRolePanelView>({ type: 'overview' });
    const [panelMessage, setPanelMessage] = useState<PanelMessage>();
    const settingsQuery = useQuery({
        queryKey: getDashboardReactionRolesSettingsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardReactionRolesSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') {
                throw new Error('Could not load reaction-role settings.');
            }

            return result;
        },
    });
    const deleteMutation = useMutation({
        mutationFn: async (messageId: string) =>
            deleteDashboardReactionRoleMessageRouteData({
                data: {
                    guildId,
                    messageId,
                },
            }),
        onSuccess: async (result) => {
            if (result.type !== 'deleted') {
                setPanelMessage({ type: 'error', text: 'Could not delete that reaction-role menu.' });
                return;
            }

            setPanelMessage({ type: 'success', text: 'Reaction-role menu deleted.' });
            await invalidateSettings();
        },
        onError: () => setPanelMessage({ type: 'error', text: 'Could not delete that reaction-role menu.' }),
    });

    async function invalidateSettings(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardReactionRolesSettingsQueryKey(guildId) });
        await queryClient.invalidateQueries({ queryKey: getDashboardAuditEventsQueryKey(guildId) });
    }

    async function handleSaved(message: PanelMessage): Promise<void> {
        setPanelMessage(message);
        await invalidateSettings();
        setView({ type: 'overview' });
    }

    if (settingsQuery.isPending) {
        return <DashboardReactionRolesLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Reaction roles</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load reaction-role settings.</p>
            </article>
        );
    }

    const emojis = [...commonEmojis, ...settingsQuery.data.emojis];

    return (
        <article
            className='rounded-lg border border-neutral-800 bg-neutral-900'
            aria-labelledby='dashboard-reaction-roles-heading'>
            <div className='flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 px-4 py-3'>
                <div>
                    <h3 id='dashboard-reaction-roles-heading' className='text-lg font-semibold text-white'>
                        Reaction roles
                    </h3>
                    <p className='mt-1 text-sm leading-6 text-neutral-400'>
                        Manage bot-owned reaction-role menus for this server.
                    </p>
                </div>
                {view.type === 'overview' ? (
                    <button
                        type='button'
                        onClick={() => {
                            setPanelMessage(undefined);
                            setView({ type: 'create' });
                        }}
                        className='min-h-10 rounded-md bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400'>
                        Create menu
                    </button>
                ) : null}
            </div>
            <ReactionRoleStatusMessages
                structureReadStatus={settingsQuery.data.structureReadStatus}
                emojiReadStatus={settingsQuery.data.emojiReadStatus}
                panelMessage={panelMessage}
            />
            {view.type === 'overview' ? (
                <ReactionRoleOverview
                    messages={settingsQuery.data.messages}
                    busyMessageId={deleteMutation.variables}
                    onCreate={() => {
                        setPanelMessage(undefined);
                        setView({ type: 'create' });
                    }}
                    onEdit={(message) => {
                        setPanelMessage(undefined);
                        setView({ type: 'edit', message });
                    }}
                    onDelete={(messageId) => deleteMutation.mutate(messageId)}
                />
            ) : (
                <ReactionRoleEditor
                    key={view.type === 'edit' ? `edit:${view.message.messageId}` : 'create'}
                    guildId={guildId}
                    editorMode={view}
                    channels={settingsQuery.data.channels}
                    roles={settingsQuery.data.roles}
                    emojis={emojis}
                    onCancel={() => setView({ type: 'overview' })}
                    onSaved={handleSaved}
                />
            )}
        </article>
    );
}

function ReactionRoleOverview({
    messages,
    busyMessageId,
    onCreate,
    onEdit,
    onDelete,
}: {
    messages: DashboardReactionRoleMessage[];
    busyMessageId?: string;
    onCreate: () => void;
    onEdit: (message: DashboardReactionRoleMessage) => void;
    onDelete: (messageId: string) => void;
}) {
    if (messages.length === 0) {
        return (
            <section className='p-4' aria-label='Reaction-role menus'>
                <div className='rounded-lg border border-dashed border-sky-500/50 bg-sky-500/5 p-5'>
                    <h4 className='text-base font-semibold text-white'>Create your first reaction-role menu</h4>
                    <p className='mt-2 max-w-2xl text-sm leading-6 text-neutral-400'>
                        Build a message, choose normal or exclusive mode, then map emojis to roles.
                    </p>
                    <button
                        type='button'
                        onClick={onCreate}
                        className='mt-4 min-h-10 rounded-md bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400'>
                        Create first reaction-role menu
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section className='space-y-3 p-4' aria-label='Reaction-role menus'>
            {messages.map((message) => (
                <article key={message.messageId} className='rounded-md border border-neutral-800 bg-neutral-950 p-3'>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                        <div className='min-w-0'>
                            <p className='font-medium text-neutral-100'>
                                {message.channelName ? `#${message.channelName}` : message.channelId}
                            </p>
                            <p className='mt-1 text-sm text-neutral-400'>
                                {message.options.length} options,{' '}
                                {message.mode === 'exclusive' ? 'exclusive' : 'normal'}
                            </p>
                            <p className='mt-1 font-mono text-xs text-neutral-600'>Message {message.messageId}</p>
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            <button
                                type='button'
                                onClick={() => onEdit(message)}
                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-300 hover:text-sky-200'>
                                Edit
                            </button>
                            <button
                                type='button'
                                onClick={() => onDelete(message.messageId)}
                                disabled={busyMessageId === message.messageId}
                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                Delete
                            </button>
                        </div>
                    </div>
                    <div className='mt-3 flex flex-wrap gap-2'>
                        {message.options.map((option) => (
                            <span
                                key={option.emojiKey}
                                className='inline-flex items-center gap-2 rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300'>
                                <span>{option.emojiLabel ?? option.emojiKey}</span>
                                <span>@{option.roleName ?? option.roleId}</span>
                            </span>
                        ))}
                    </div>
                </article>
            ))}
        </section>
    );
}

function ReactionRoleStatusMessages({
    structureReadStatus,
    emojiReadStatus,
    panelMessage,
}: {
    structureReadStatus: 'available' | 'bot-token-missing' | 'fetch-failed';
    emojiReadStatus: 'available' | 'bot-token-missing' | 'fetch-failed';
    panelMessage?: PanelMessage;
}) {
    return (
        <>
            {structureReadStatus === 'bot-token-missing' ? (
                <p className='border-b border-neutral-800 px-4 py-3 text-sm leading-6 text-rose-300'>
                    Set FLUXER_BOT_TOKEN for the web service to load channels, roles, and publish menus.
                </p>
            ) : null}
            {structureReadStatus === 'fetch-failed' ? (
                <p className='border-b border-neutral-800 px-4 py-3 text-sm leading-6 text-rose-300'>
                    Could not read server channels or roles.
                </p>
            ) : null}
            {emojiReadStatus === 'fetch-failed' ? (
                <p className='border-b border-neutral-800 px-4 py-3 text-sm leading-6 text-amber-300'>
                    Custom server emojis are unavailable. Common emoji still work.
                </p>
            ) : null}
            {panelMessage ? (
                <p
                    className={`border-b border-neutral-800 px-4 py-3 text-sm leading-6 ${getPanelMessageClassName(panelMessage.type)}`}>
                    {panelMessage.text}
                </p>
            ) : null}
        </>
    );
}

function DashboardReactionRolesLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-40 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 space-y-3'>
                <div className='h-4 w-72 animate-pulse rounded bg-neutral-800' />
                <div className='h-10 w-full animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function getPanelMessageClassName(type: PanelMessage['type']): string {
    if (type === 'success') return 'text-emerald-300';
    if (type === 'warning') return 'text-amber-300';
    return 'text-rose-300';
}
