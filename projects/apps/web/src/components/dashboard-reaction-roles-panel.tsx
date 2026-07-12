import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
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
import {
    dashboardContentTransition,
    dashboardContentVariants,
    dashboardFastTransition,
    dashboardInlineVariants,
    dashboardListItemVariants,
    dashboardTactile,
} from './dashboard-motion.js';
import { ReactionRoleEditor } from './dashboard-reaction-role-editor.js';
import { DashboardEmptyState, DashboardErrorState, DashboardStatus, DashboardSurface } from './dashboard-ui.js';

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
    const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState('');
    const [retryConfirmOperationId, setRetryConfirmOperationId] = useState('');
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
        if (unknownPublish && retryConfirmOperationId !== operation.id) {
            setRetryConfirmOperationId(operation.id);
            setPanelMessage({
                type: 'warning',
                text: 'Check the Fluxer channel and remove any orphan message. Select the retry action again only after the channel is clear.',
            });
            return;
        }
        setRetryConfirmOperationId('');
        retryMutation.mutate({ confirmUnknownPublishAbsent: unknownPublish, operationId: operation.id });
    }

    function deleteMenu(message: DashboardReactionRoleMessage): void {
        if (deleteConfirmMessageId !== message.messageId) {
            setDeleteConfirmMessageId(message.messageId);
            setPanelMessage({
                type: 'warning',
                text: 'Delete this menu? NeonFlux will remove the live Fluxer message and every role grant managed by it. Select delete again to confirm.',
            });
            return;
        }

        setDeleteConfirmMessageId('');
        deleteMutation.mutate(message);
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
            <DashboardErrorState
                title='Reaction-role menus could not load'
                description='No settings were changed. Reload the page or try again after the server connection recovers.'
            />
        );
    }

    const emojis = [...commonEmojis, ...settingsQuery.data.emojis];

    return (
        <DashboardSurface as='section' padding='none' aria-labelledby='dashboard-reaction-role-menus-heading'>
            <div className='flex flex-wrap items-end justify-between gap-4 border-b border-[var(--dash-border)] px-4 py-4 sm:px-5'>
                <div>
                    <h3
                        id='dashboard-reaction-role-menus-heading'
                        className='text-base font-semibold text-[var(--dash-text)]'>
                        {view.type === 'overview' ? 'Menus' : view.type === 'create' ? 'Create menu' : 'Edit menu'}
                    </h3>
                    <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                        {view.type === 'overview'
                            ? 'Bot-owned menus stay locked while Fluxer synchronization is active or needs attention.'
                            : 'Changes remain disabled until Fluxer and stored configuration agree.'}
                    </p>
                </div>
                {view.type === 'overview' ? (
                    <motion.button
                        type='button'
                        onClick={() => {
                            setPanelMessage(undefined);
                            setDeleteConfirmMessageId('');
                            setView({ type: 'create' });
                        }}
                        className={primaryButtonClassName}
                        {...dashboardTactile}>
                        Create menu
                    </motion.button>
                ) : null}
            </div>
            <ReactionRoleStatusMessages
                structureReadStatus={settingsQuery.data.structureReadStatus}
                emojiReadStatus={settingsQuery.data.emojiReadStatus}
                panelMessage={panelMessage}
            />
            <motion.div
                key={view.type === 'edit' ? `edit:${view.message.messageId}` : view.type}
                variants={dashboardContentVariants}
                initial='initial'
                animate='enter'
                transition={dashboardContentTransition}>
                {view.type === 'overview' ? (
                    <ReactionRoleOverview
                        messages={settingsQuery.data.messages}
                        operations={settingsQuery.data.operations}
                        busyMessageId={deleteMutation.isPending ? deleteMutation.variables.messageId : undefined}
                        deleteConfirmMessageId={deleteConfirmMessageId}
                        retryConfirmOperationId={retryConfirmOperationId}
                        onCancelDelete={() => setDeleteConfirmMessageId('')}
                        onCreate={() => {
                            setPanelMessage(undefined);
                            setView({ type: 'create' });
                        }}
                        onEdit={(message) => {
                            setPanelMessage(undefined);
                            setDeleteConfirmMessageId('');
                            setView({ type: 'edit', message });
                        }}
                        onDelete={deleteMenu}
                        onRetry={retryOperation}
                        onRetryMembers={(message) => retryMembersMutation.mutate(message.messageId)}
                    />
                ) : (
                    <ReactionRoleEditor
                        guildId={guildId}
                        editorMode={view}
                        channels={settingsQuery.data.channels}
                        roles={settingsQuery.data.roles}
                        emojis={emojis}
                        onCancel={() => setView({ type: 'overview' })}
                        onSaved={handleSaved}
                    />
                )}
            </motion.div>
        </DashboardSurface>
    );
}

function ReactionRoleOverview({
    messages,
    operations,
    busyMessageId,
    deleteConfirmMessageId,
    retryConfirmOperationId,
    onCancelDelete,
    onCreate,
    onEdit,
    onDelete,
    onRetry,
    onRetryMembers,
}: {
    messages: DashboardReactionRoleMessage[];
    operations: DashboardReactionRoleOperation[];
    busyMessageId?: string;
    deleteConfirmMessageId: string;
    retryConfirmOperationId: string;
    onCancelDelete: () => void;
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
            <DashboardEmptyState
                title='Create your first reaction-role menu'
                description='Build a message, choose normal or exclusive assignment, then map each emoji to one role.'
                action={
                    <motion.button
                        type='button'
                        onClick={onCreate}
                        className={primaryButtonClassName}
                        {...dashboardTactile}>
                        Create first menu
                    </motion.button>
                }
            />
        );
    }

    return (
        <section className='space-y-3 p-4 sm:p-5' aria-label='Reaction-role menus'>
            {pendingPublishes.map((operation) => (
                <ReactionRoleOperationStatus
                    key={operation.id}
                    operation={operation}
                    retryConfirmOperationId={retryConfirmOperationId}
                    onRetry={onRetry}
                />
            ))}
            {messages.map((message) => (
                <motion.article
                    key={message.messageId}
                    className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] p-3 sm:p-4'
                    variants={dashboardListItemVariants}
                    initial='initial'
                    animate='enter'
                    transition={dashboardFastTransition}>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                        <div className='min-w-0'>
                            <p className='font-medium text-[var(--dash-text)]'>
                                {message.channelName ? `#${message.channelName}` : message.channelId}
                            </p>
                            <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                                {message.options.length} options,{' '}
                                {message.mode === 'exclusive' ? 'exclusive' : 'normal'} ·{' '}
                                {formatLifecycle(message.lifecycle)}
                            </p>
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            <motion.button
                                type='button'
                                onClick={() => onEdit(message)}
                                disabled={message.lifecycle !== 'ready'}
                                className={secondaryButtonClassName}
                                {...dashboardTactile}>
                                Edit
                            </motion.button>
                            <motion.button
                                type='button'
                                onClick={() => onDelete(message)}
                                disabled={busyMessageId === message.messageId || message.lifecycle !== 'ready'}
                                className={dangerButtonClassName}
                                {...dashboardTactile}>
                                {deleteConfirmMessageId === message.messageId ? 'Confirm delete' : 'Delete'}
                            </motion.button>
                            <AnimatePresence initial={false}>
                                {deleteConfirmMessageId === message.messageId ? (
                                    <motion.button
                                        key='cancel-delete'
                                        type='button'
                                        onClick={onCancelDelete}
                                        className={secondaryButtonClassName}
                                        variants={dashboardInlineVariants}
                                        initial='initial'
                                        animate='enter'
                                        transition={dashboardFastTransition}
                                        {...dashboardTactile}>
                                        Cancel
                                    </motion.button>
                                ) : null}
                            </AnimatePresence>
                        </div>
                    </div>
                    <div className='mt-3 flex flex-wrap gap-2'>
                        {message.options.map((option) => (
                            <span
                                key={option.emojiKey}
                                className='inline-flex items-center gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-2 py-1 text-xs text-[var(--dash-text-muted)]'>
                                <span>{option.emojiLabel ?? option.emojiKey}</span>
                                <span>@{option.roleName ?? option.roleId}</span>
                            </span>
                        ))}
                    </div>
                    {message.pendingOperationId ? (
                        <ReactionRoleOperationStatus
                            operation={operations.find((operation) => operation.id === message.pendingOperationId)}
                            retryConfirmOperationId={retryConfirmOperationId}
                            onRetry={onRetry}
                        />
                    ) : null}
                    {message.lifecycle === 'needs_attention' && !message.pendingOperationId ? (
                        <DashboardStatus
                            tone='danger'
                            title='Role assignment needs administrator attention'
                            actions={
                                <button
                                    type='button'
                                    onClick={() => onRetryMembers(message)}
                                    className={statusActionButtonClassName}>
                                    Retry blocked assignments
                                </button>
                            }>
                            <p>Correct the bot permission or role hierarchy, then retry the blocked assignment.</p>
                        </DashboardStatus>
                    ) : null}
                </motion.article>
            ))}
        </section>
    );
}

function ReactionRoleOperationStatus({
    operation,
    retryConfirmOperationId,
    onRetry,
}: {
    operation?: DashboardReactionRoleOperation;
    retryConfirmOperationId: string;
    onRetry: (operation: DashboardReactionRoleOperation) => void;
}) {
    if (!operation) return null;
    const progress =
        operation.totalCount > 0 ? ` ${operation.processedCount}/${operation.totalCount} grants processed.` : '';
    return (
        <div className='mt-3'>
            <DashboardStatus
                tone={operation.status === 'needs_attention' ? 'danger' : 'warning'}
                title={
                    operation.status === 'needs_attention'
                        ? 'Needs administrator attention'
                        : `${operation.type} in progress`
                }
                actions={
                    operation.status === 'needs_attention' ? (
                        <button
                            type='button'
                            onClick={() => onRetry(operation)}
                            className={statusActionButtonClassName}>
                            {operation.errorCode === 'unknown_publish_outcome' &&
                            retryConfirmOperationId === operation.id
                                ? 'Confirm channel is clear'
                                : operation.errorCode === 'unknown_publish_outcome'
                                  ? 'Verify channel, then retry'
                                  : 'Retry synchronization'}
                        </button>
                    ) : undefined
                }>
                <p>
                    {operation.errorCode
                        ? formatOperationError(operation.errorCode)
                        : 'The bot is synchronizing this menu.'}
                    {progress}
                </p>
            </DashboardStatus>
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
    if (structureReadStatus === 'available' && emojiReadStatus === 'available' && !panelMessage) return null;

    return (
        <div className='space-y-2 border-b border-[var(--dash-border)] px-4 py-3 sm:px-5'>
            {structureReadStatus === 'bot-token-missing' ? (
                <DashboardStatus tone='danger'>
                    Set FLUXER_BOT_TOKEN for the web service to load channels, roles, and publish menus.
                </DashboardStatus>
            ) : null}
            {structureReadStatus === 'fetch-failed' ? (
                <DashboardStatus tone='danger'>Could not read server channels or roles.</DashboardStatus>
            ) : null}
            {emojiReadStatus === 'fetch-failed' ? (
                <DashboardStatus tone='warning'>
                    Custom server emojis are unavailable. Common emoji still work.
                </DashboardStatus>
            ) : null}
            {panelMessage ? (
                <DashboardStatus tone={getPanelMessageTone(panelMessage.type)}>{panelMessage.text}</DashboardStatus>
            ) : null}
        </div>
    );
}

function DashboardReactionRolesLoading() {
    return (
        <DashboardSurface as='article' aria-busy='true' aria-label='Loading reaction-role menus'>
            <div className='h-5 w-40 animate-pulse rounded bg-[var(--dash-surface-selected)]' />
            <div className='mt-4 space-y-3'>
                <div className='h-4 w-72 animate-pulse rounded bg-[var(--dash-surface-selected)]' />
                <div className='h-10 w-full animate-pulse rounded bg-[var(--dash-surface-selected)]' />
            </div>
        </DashboardSurface>
    );
}

function getPanelMessageTone(type: PanelMessage['type']): 'danger' | 'success' | 'warning' {
    if (type === 'success') return 'success';
    if (type === 'warning') return 'warning';
    return 'danger';
}

const primaryButtonClassName =
    'inline-flex min-h-10 items-center justify-center rounded-[var(--dash-radius-control)] bg-[var(--dash-primary)] px-4 text-sm font-semibold text-[#06111a] transition hover:bg-[var(--dash-primary-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dash-primary)] disabled:cursor-not-allowed disabled:bg-[var(--dash-surface-muted)] disabled:text-[var(--dash-text-disabled)]';
const secondaryButtonClassName =
    'inline-flex min-h-9 items-center justify-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] px-3 text-sm font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-primary)] hover:text-[var(--dash-primary)] disabled:cursor-not-allowed disabled:border-[var(--dash-border)] disabled:text-[var(--dash-text-disabled)]';
const dangerButtonClassName =
    'inline-flex min-h-9 items-center justify-center rounded-[var(--dash-radius-control)] border border-rose-400/45 px-3 text-sm font-semibold text-rose-100 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:border-[var(--dash-border)] disabled:text-[var(--dash-text-disabled)]';
const statusActionButtonClassName =
    'inline-flex min-h-9 items-center rounded-[var(--dash-radius-control)] border border-current px-3 text-xs font-semibold';
