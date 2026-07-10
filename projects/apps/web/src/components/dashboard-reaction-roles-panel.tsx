import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
    getDashboardAuditEventsBaseQueryKey,
    getDashboardReactionRolesSettingsQueryKey,
} from '../dashboard-query-keys.js';
import {
    deleteDashboardReactionRoleMessageRouteData,
    readDashboardReactionRolesSettingsRouteData,
    retryDashboardReactionRoleOperationRouteData,
    retryDashboardReactionRoleMembersRouteData,
} from '../server/dashboard-reaction-roles-route-data.js';
import type {
    DashboardReactionRoleEmoji,
    DashboardReactionRoleMessage,
    DashboardReactionRoleOperation,
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
        mutationFn: async (message: DashboardReactionRoleMessage) =>
            deleteDashboardReactionRoleMessageRouteData({
                data: {
                    expectedRevision: message.revision,
                    guildId,
                    idempotencyKey: crypto.randomUUID(),
                    messageId: message.messageId,
                },
            }),
        onSuccess: async (result) => {
            if (result.type !== 'operation-accepted' && result.type !== 'operation-existing') {
                setPanelMessage({ type: 'error', text: 'Could not delete that reaction-role menu.' });
                return;
            }

            setPanelMessage({
                type: 'warning',
                text: 'Deletion queued. The menu stays disabled until grants are removed and the live message is deleted.',
            });
            await invalidateSettings();
        },
        onError: () => setPanelMessage({ type: 'error', text: 'Could not delete that reaction-role menu.' }),
    });
    const retryMutation = useMutation({
        mutationFn: async (input: { confirmUnknownPublishAbsent: boolean; operationId: string }) =>
            retryDashboardReactionRoleOperationRouteData({ data: { guildId, ...input } }),
        onSuccess: async (result) => {
            setPanelMessage(
                result.type === 'operation-accepted'
                    ? { type: 'warning', text: 'Synchronization retry queued.' }
                    : { type: 'error', text: 'Could not retry this operation.' }
            );
            await invalidateSettings();
        },
        onError: () => setPanelMessage({ type: 'error', text: 'Could not retry this operation.' }),
    });
    const retryMembersMutation = useMutation({
        mutationFn: async (messageId: string) =>
            retryDashboardReactionRoleMembersRouteData({ data: { guildId, messageId } }),
        onSuccess: async (result) => {
            setPanelMessage(
                result.type === 'member-retry-queued'
                    ? {
                          type: 'warning',
                          text: result.hasMore
                              ? `Queued ${result.retriedCount} blocked assignments. Retry again to queue the remaining assignments.`
                              : 'Blocked role assignments were queued after the administrator correction.',
                      }
                    : { type: 'error', text: 'Could not retry blocked role assignments.' }
            );
            await invalidateSettings();
        },
        onError: () => setPanelMessage({ type: 'error', text: 'Could not retry blocked role assignments.' }),
    });

    function retryOperation(operation: DashboardReactionRoleOperation): void {
        const unknownPublish = operation.errorCode === 'unknown_publish_outcome';
        if (
            unknownPublish &&
            !window.confirm(
                'Confirm that you checked the Fluxer channel and removed any message from the uncertain publish. Retry only when no orphan message remains.'
            )
        ) {
            return;
        }
        retryMutation.mutate({ confirmUnknownPublishAbsent: unknownPublish, operationId: operation.id });
    }

    async function invalidateSettings(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey: getDashboardReactionRolesSettingsQueryKey(guildId) });
        await queryClient.invalidateQueries({ queryKey: getDashboardAuditEventsBaseQueryKey(guildId) });
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
                    operations={settingsQuery.data.operations}
                    busyMessageId={deleteMutation.variables?.messageId}
                    onCreate={() => {
                        setPanelMessage(undefined);
                        setView({ type: 'create' });
                    }}
                    onEdit={(message) => {
                        setPanelMessage(undefined);
                        setView({ type: 'edit', message });
                    }}
                    onDelete={(message) => {
                        const confirmed = window.confirm(
                            'Delete the live Fluxer message and remove every role this menu granted? The menu remains disabled until cleanup finishes.'
                        );
                        if (confirmed) deleteMutation.mutate(message);
                    }}
                    onRetry={retryOperation}
                    onRetryMembers={(message) => retryMembersMutation.mutate(message.messageId)}
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
    operations,
    busyMessageId,
    onCreate,
    onEdit,
    onDelete,
    onRetry,
    onRetryMembers,
}: {
    messages: DashboardReactionRoleMessage[];
    operations: DashboardReactionRoleOperation[];
    busyMessageId?: string;
    onCreate: () => void;
    onEdit: (message: DashboardReactionRoleMessage) => void;
    onDelete: (message: DashboardReactionRoleMessage) => void;
    onRetry: (operation: DashboardReactionRoleOperation) => void;
    onRetryMembers: (message: DashboardReactionRoleMessage) => void;
}) {
    const pendingPublishes = operations.filter(
        (operation) => operation.type === 'publish' && operation.status !== 'succeeded'
    );

    if (messages.length === 0 && pendingPublishes.length === 0) {
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
            {pendingPublishes.map((operation) => (
                <ReactionRoleOperationStatus key={operation.id} operation={operation} onRetry={onRetry} />
            ))}
            {messages.map((message) => (
                <article key={message.messageId} className='rounded-md border border-neutral-800 bg-neutral-950 p-3'>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                        <div className='min-w-0'>
                            <p className='font-medium text-neutral-100'>
                                {message.channelName ? `#${message.channelName}` : message.channelId}
                            </p>
                            <p className='mt-1 text-sm text-neutral-400'>
                                {message.options.length} options,{' '}
                                {message.mode === 'exclusive' ? 'exclusive' : 'normal'} ·{' '}
                                {formatLifecycle(message.lifecycle)}
                            </p>
                            <p className='mt-1 font-mono text-xs text-neutral-600'>Message {message.messageId}</p>
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            <button
                                type='button'
                                onClick={() => onEdit(message)}
                                disabled={message.lifecycle !== 'ready'}
                                className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-300 hover:text-sky-200'>
                                Edit
                            </button>
                            <button
                                type='button'
                                onClick={() => onDelete(message)}
                                disabled={busyMessageId === message.messageId || message.lifecycle !== 'ready'}
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
                    {message.pendingOperationId ? (
                        <ReactionRoleOperationStatus
                            operation={operations.find((operation) => operation.id === message.pendingOperationId)}
                            onRetry={onRetry}
                        />
                    ) : null}
                    {message.lifecycle === 'needs_attention' && !message.pendingOperationId ? (
                        <div className='mt-3 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'>
                            <p className='font-medium'>Role assignment needs administrator attention</p>
                            <p className='mt-1 text-xs opacity-80'>
                                Correct the bot permission or role hierarchy, then retry the blocked assignment.
                            </p>
                            <button
                                type='button'
                                onClick={() => onRetryMembers(message)}
                                className='mt-2 min-h-9 rounded-md border border-current px-3 text-xs font-semibold'>
                                Retry blocked assignments
                            </button>
                        </div>
                    ) : null}
                </article>
            ))}
        </section>
    );
}

function ReactionRoleOperationStatus({
    operation,
    onRetry,
}: {
    operation?: DashboardReactionRoleOperation;
    onRetry: (operation: DashboardReactionRoleOperation) => void;
}) {
    if (!operation) return null;
    const progress =
        operation.totalCount > 0 ? ` ${operation.processedCount}/${operation.totalCount} grants processed.` : '';
    return (
        <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                operation.status === 'needs_attention'
                    ? 'border-rose-500/50 bg-rose-500/10 text-rose-200'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
            }`}>
            <p className='font-medium'>
                {operation.status === 'needs_attention'
                    ? 'Needs administrator attention'
                    : `${operation.type} in progress`}
            </p>
            <p className='mt-1 text-xs opacity-80'>
                {operation.errorCode
                    ? formatOperationError(operation.errorCode)
                    : 'The bot is synchronizing this menu.'}
                {progress}
            </p>
            {operation.status === 'needs_attention' ? (
                <button
                    type='button'
                    onClick={() => onRetry(operation)}
                    className='mt-2 min-h-9 rounded-md border border-current px-3 text-xs font-semibold'>
                    {operation.errorCode === 'unknown_publish_outcome'
                        ? 'I removed any orphan, retry publish'
                        : 'Retry synchronization'}
                </button>
            ) : null}
        </div>
    );
}

function formatLifecycle(lifecycle: DashboardReactionRoleMessage['lifecycle']): string {
    if (lifecycle === 'needs_attention') return 'needs attention';
    if (lifecycle === 'deleting') return 'deleting';
    if (lifecycle === 'syncing') return 'syncing';
    return 'ready';
}

function formatOperationError(errorCode: string): string {
    if (errorCode === 'unknown_publish_outcome') {
        return 'Fluxer may have created the message, so NeonFlux will not retry automatically. Check the channel and remove any orphan before trying again.';
    }
    if (errorCode === 'role_hierarchy_blocked') {
        return 'The bot cannot remove one or more granted roles. Move the bot role above them, then retry.';
    }
    if (errorCode === 'permission-denied') {
        return 'Fluxer denied a required action. Restore the bot permission, then retry.';
    }
    return `Synchronization stopped: ${errorCode.replaceAll('_', ' ')}.`;
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
