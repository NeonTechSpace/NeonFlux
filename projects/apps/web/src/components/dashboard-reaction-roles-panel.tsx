import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, MoveDown, MoveUp, Plus, Save, SortAsc, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';

import type { OutgoingEmbed } from '@neonflux/messaging';
import {
    getReactionRoleEmojiKey,
    MAX_REACTION_ROLE_OPTIONS,
    parseReactionRolePanelDraft,
    projectReactionRoleMessage,
} from '@neonflux/reaction-roles';
import type { ReactionRoleEmoji, ReactionRoleMode, ReactionRoleOption } from '@neonflux/reaction-roles';

import { getDashboardReactionRolesQueryKey } from '../dashboard-query-keys.js';
import {
    deactivateDashboardReactionRoleRouteData,
    publishDashboardReactionRoleRouteData,
    readDashboardReactionRolesRouteData,
    updateDashboardReactionRoleRouteData,
} from '../server/dashboard-reaction-roles-route-data.js';
import type {
    DashboardReactionRoleMutationResult,
    DashboardReactionRolePanel as StoredPanel,
} from '../server/dashboard-reaction-roles.server.js';
import type { DashboardPostingChannel, DashboardPostingRole } from '../server/dashboard-posting.server.js';
import {
    DashboardEmbedBuilder,
    createEmptyDashboardEmbedDraft,
    normalizeDashboardEmbedDraft,
    toDashboardEmbedDraft,
} from './dashboard-embed-builder.js';
import type { DashboardEmbedDraft } from './dashboard-embed-builder.js';
import { DashboardPostingPreview } from './dashboard-posting-preview.js';
import {
    dashboardDangerActionClassName,
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    dashboardQuietActionClassName,
    dashboardSecondaryActionClassName,
    DashboardEmptyState,
    DashboardStatus,
    DashboardSurface,
} from './dashboard-ui.js';

type FormNotice = { text: string; tone: 'danger' | 'success' | 'warning' };
const defaultUnicodeEmojis = [
    '✨',
    '🌟',
    '🔥',
    '💧',
    '🌿',
    '🌙',
    '☀️',
    '⚡',
    '🎨',
    '🎮',
    '🎵',
    '📚',
    '💻',
    '📣',
    '🎉',
    '❤️',
    '🧡',
    '💛',
    '💚',
    '💙',
    '💜',
    '🤍',
    '🖤',
    '🩷',
    '🩵',
    '🩶',
    '✅',
    '🔔',
    '🚀',
    '🏆',
] as const;

export function DashboardReactionRolesPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardReactionRolesQueryKey(guildId);
    const query = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardReactionRolesRouteData({ data: { guildId } });
            if (result.type !== 'reaction-roles') throw new Error(result.type);
            return result;
        },
        retry: false,
        staleTime: 20_000,
    });
    const [editing, setEditing] = useState<StoredPanel>();
    const [name, setName] = useState('');
    const [channelId, setChannelId] = useState('');
    const [content, setContent] = useState('');
    const [embedDraft, setEmbedDraft] = useState<DashboardEmbedDraft>(createEmptyDashboardEmbedDraft);
    const [mode, setMode] = useState<ReactionRoleMode>('independent');
    const [options, setOptions] = useState<ReactionRoleOption[]>([]);
    const [draggedOptionId, setDraggedOptionId] = useState<string>();
    const [pendingDeactivation, setPendingDeactivation] = useState<'delete-revoke' | 'keep'>();
    const [notice, setNotice] = useState<FormNotice>();

    const embedResult = normalizeDashboardEmbedDraft(embedDraft);
    const embeds: OutgoingEmbed[] = embedResult.valid && embedResult.embed ? [embedResult.embed] : [];
    const draft = { ...(content.trim() ? { content } : {}), embeds, mode, options };
    const draftValidation = parseReactionRolePanelDraft(draft);
    const projection = projectReactionRoleMessage(draft);
    const channels = useMemo(
        () => toPostingChannels(query.data?.catalog.channels.filter((channel) => channel.eligible) ?? []),
        [query.data?.catalog.channels]
    );
    const roles = useMemo(
        () => toPostingRoles(query.data?.catalog.roles.filter((role) => role.eligible) ?? []),
        [query.data?.catalog.roles]
    );
    const refreshedEditing = editing
        ? query.data?.panels.find((panel) => panel.id === editing.id && panel.version === editing.version)
        : undefined;
    const effectiveEditing = refreshedEditing ?? editing;

    const mutation = useMutation({
        mutationFn: async () => {
            if (!embedResult.valid) return { message: embedResult.message, type: 'invalid-panel' } as const;
            if (draftValidation.isErr()) {
                return {
                    message: `Fix ${draftValidation.error.path.replace('panel.', '')} before saving.`,
                    type: 'invalid-panel',
                } as const;
            }
            const payload = draftValidation.value;
            if (effectiveEditing) {
                return updateDashboardReactionRoleRouteData({
                    data: {
                        channelId,
                        expectedUpdatedAt: effectiveEditing.updatedAt,
                        guildId,
                        name,
                        panelId: effectiveEditing.id,
                        payload,
                        requestKey: crypto.randomUUID(),
                    },
                });
            }
            return publishDashboardReactionRoleRouteData({
                data: { channelId, guildId, name, payload, requestKey: crypto.randomUUID() },
            });
        },
        onSuccess: async (result: DashboardReactionRoleMutationResult) => {
            if (result.type !== 'panel') {
                setNotice({
                    tone: result.type === 'conflict' ? 'warning' : 'danger',
                    text:
                        result.type === 'invalid-panel'
                            ? result.message
                            : result.type === 'conflict'
                              ? 'This panel changed elsewhere. Refresh before saving again.'
                              : formatPanelWriteError(result.type, 'save'),
                });
                return;
            }
            setEditing(result.panel);
            setNotice({
                tone: 'success',
                text: result.panel.status === 'publishing' ? 'Panel queued for publication.' : 'Panel update queued.',
            });
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: () =>
            setNotice({
                tone: 'danger',
                text: 'The connection ended before NeonFlux could save the panel. Try again.',
            }),
    });
    const deactivateMutation = useMutation({
        mutationFn: async (input: { deleteMessage: boolean; revokeOwnedRoles: boolean }) => {
            if (!effectiveEditing) throw new Error('No panel selected');
            return deactivateDashboardReactionRoleRouteData({
                data: {
                    ...input,
                    expectedUpdatedAt: effectiveEditing.updatedAt,
                    guildId,
                    panelId: effectiveEditing.id,
                    requestKey: crypto.randomUUID(),
                },
            });
        },
        onSuccess: async (result) => {
            if (result.type !== 'panel') {
                setNotice({ tone: 'danger', text: formatPanelWriteError(result.type, 'deactivate') });
                return;
            }
            setNotice({ tone: 'success', text: 'Panel deactivation queued.' });
            setPendingDeactivation(undefined);
            setEditing(result.panel);
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: () => {
            setPendingDeactivation(undefined);
            setNotice({
                tone: 'danger',
                text: 'The connection ended before NeonFlux could deactivate the panel. Try again.',
            });
        },
    });

    function editPanel(panel: StoredPanel) {
        setEditing(panel);
        setName(panel.name);
        setChannelId(panel.channelId);
        setContent(panel.payload.content ?? '');
        setEmbedDraft(toDashboardEmbedDraft(panel.payload.embeds[0]));
        setMode(panel.payload.mode);
        setOptions(panel.payload.options);
        setPendingDeactivation(undefined);
        setNotice(undefined);
    }

    function newPanel() {
        setEditing(undefined);
        setName('');
        setChannelId('');
        setContent('');
        setEmbedDraft(createEmptyDashboardEmbedDraft());
        setMode('independent');
        setOptions([]);
        setPendingDeactivation(undefined);
        setNotice(undefined);
    }

    function addOption() {
        if (options.length >= MAX_REACTION_ROLE_OPTIONS) return;
        const role = query.data?.catalog.roles.find(
            (candidate) => candidate.eligible && !options.some((option) => option.roleId === candidate.id)
        );
        if (!role) {
            setNotice({ tone: 'warning', text: 'No additional eligible role is available.' });
            return;
        }
        setOptions((current) => {
            const usedEmojiKeys = new Set(current.map((option) => getReactionRoleEmojiKey(option.emoji)));
            const defaultEmoji =
                defaultUnicodeEmojis.find(
                    (value) => !usedEmojiKeys.has(getReactionRoleEmojiKey({ kind: 'unicode', value }))
                ) ?? '✨';
            return [
                ...current,
                {
                    emoji: { kind: 'unicode', value: defaultEmoji },
                    id: crypto.randomUUID(),
                    roleId: role.id,
                    roleName: role.name,
                },
            ];
        });
    }

    function updateOption(id: string, update: (option: ReactionRoleOption) => ReactionRoleOption) {
        setOptions((current) => current.map((option) => (option.id === id ? update(option) : option)));
        setNotice(undefined);
    }

    function moveOption(id: string, offset: -1 | 1) {
        setOptions((current) => {
            const index = current.findIndex((option) => option.id === id);
            const target = index + offset;
            if (index < 0 || target < 0 || target >= current.length) return current;
            const next = [...current];
            const [moved] = next.splice(index, 1);
            next.splice(target, 0, moved);
            return next;
        });
    }

    function dropOption(event: DragEvent<HTMLDivElement>, targetId: string) {
        event.preventDefault();
        if (!draggedOptionId || draggedOptionId === targetId) return;
        setOptions((current) => {
            const from = current.findIndex((option) => option.id === draggedOptionId);
            const to = current.findIndex((option) => option.id === targetId);
            if (from < 0 || to < 0) return current;
            const next = [...current];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
        setDraggedOptionId(undefined);
    }

    const editingAllowed =
        !effectiveEditing || effectiveEditing.status === 'active' || effectiveEditing.status === 'degraded';
    const saveDisabled =
        mutation.isPending ||
        !editingAllowed ||
        !name.trim() ||
        !channelId ||
        !embedResult.valid ||
        draftValidation.isErr() ||
        projection.isErr();

    if (query.isPending) {
        return (
            <DashboardSurface tone='glass'>
                <DashboardStatus tone='info'>Loading channels, roles, emoji, and managed panels…</DashboardStatus>
            </DashboardSurface>
        );
    }
    if (query.isError) {
        return (
            <DashboardSurface tone='glass' className='space-y-3'>
                <DashboardStatus tone='danger'>
                    Reaction roles could not be loaded from the connected bot.
                </DashboardStatus>
                <button
                    className={dashboardSecondaryActionClassName}
                    disabled={query.isFetching}
                    aria-busy={query.isFetching || undefined}
                    onClick={() => void query.refetch()}>
                    {query.isFetching ? 'Retrying…' : 'Retry'}
                </button>
            </DashboardSurface>
        );
    }

    return (
        <div className='grid min-w-0 gap-4 xl:grid-cols-[18rem_minmax(0,1.2fr)_minmax(22rem,0.8fr)]'>
            <DashboardSurface tone='glass' padding='compact' className='space-y-3 xl:sticky xl:top-4 xl:self-start'>
                <div className='flex items-center justify-between gap-2'>
                    <div>
                        <h2 className='font-semibold text-[var(--dash-text)]'>Panels</h2>
                        <p className='text-xs text-[var(--dash-text-muted)]'>{query.data.panels.length} configured</p>
                    </div>
                    <button className={dashboardSecondaryActionClassName} onClick={newPanel}>
                        <Plus className='mr-1 inline size-4' /> New
                    </button>
                </div>
                {query.data.panels.length === 0 ? (
                    <DashboardEmptyState
                        size='compact'
                        title='No panels yet'
                        description='Create a focused menu for one set of roles.'
                    />
                ) : (
                    <div className='space-y-2'>
                        {query.data.panels.map((panel) => (
                            <button
                                key={panel.id}
                                type='button'
                                onClick={() => editPanel(panel)}
                                className={`w-full rounded-[var(--dash-radius-control)] border p-3 text-left ${
                                    editing?.id === panel.id
                                        ? 'border-[var(--dash-primary)] bg-[var(--dash-primary-soft)]'
                                        : 'border-[var(--dash-border)] bg-[var(--dash-surface-muted)]'
                                }`}>
                                <span className='block truncate text-sm font-semibold text-[var(--dash-text)]'>
                                    {panel.name}
                                </span>
                                <span className='mt-1 block text-xs text-[var(--dash-text-muted)]'>
                                    {formatPanelStatus(panel.status)} · {panel.payload.options.length} roles
                                </span>
                                {panel.errorCode ? (
                                    <span className='mt-1 block text-xs text-[var(--dash-danger)]'>
                                        {formatPanelAttention(panel.errorCode)}
                                        <span className='mt-0.5 block font-mono text-[10px] text-[var(--dash-text-subtle)]'>
                                            Error code: {panel.errorCode}
                                        </span>
                                    </span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                )}
            </DashboardSurface>

            <DashboardSurface tone='glass' className='space-y-5' aria-label='Reaction role editor'>
                <div className='grid gap-3 sm:grid-cols-2'>
                    <label className='space-y-2 text-sm font-semibold text-[var(--dash-text)]'>
                        <span>Panel name</span>
                        <input
                            className={dashboardFieldClassName}
                            value={name}
                            maxLength={80}
                            onChange={(event) => setName(event.currentTarget.value)}
                            placeholder='Community roles'
                        />
                    </label>
                    <label className='space-y-2 text-sm font-semibold text-[var(--dash-text)]'>
                        <span>Channel</span>
                        <select
                            className={dashboardFieldClassName}
                            disabled={editing !== undefined}
                            value={channelId}
                            onChange={(event) => setChannelId(event.currentTarget.value)}>
                            <option value=''>Choose a channel</option>
                            {query.data.catalog.channels
                                .filter((channel) => channel.eligible)
                                .map((channel) => (
                                    <option key={channel.id} value={channel.id}>
                                        {channel.parentName ? `${channel.parentName} / ` : ''}#{channel.name}
                                    </option>
                                ))}
                        </select>
                        {editing ? (
                            <span className='block text-xs font-normal text-[var(--dash-text-muted)]'>
                                Published panels stay in their original channel.
                            </span>
                        ) : null}
                    </label>
                </div>

                <label className='space-y-2 text-sm font-semibold text-[var(--dash-text)]'>
                    <span>Message content</span>
                    <textarea
                        className={`${dashboardFieldClassName} min-h-28 py-3`}
                        value={content}
                        onChange={(event) => setContent(event.currentTarget.value)}
                        placeholder={`Write an introduction. Put {roles} exactly where the live role list should appear.`}
                    />
                    <span className='block text-xs font-normal text-[var(--dash-text-muted)]'>
                        If <code>{'{roles}'}</code> is omitted, the list is appended to the embed, or to normal content
                        when there is no embed.
                    </span>
                </label>

                <details className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] p-3'>
                    <summary className='cursor-pointer text-sm font-semibold text-[var(--dash-text)]'>
                        Optional embed
                    </summary>
                    <div className='mt-4'>
                        <DashboardEmbedBuilder draft={embedDraft} onDraftChange={setEmbedDraft} />
                    </div>
                </details>

                <fieldset className='space-y-2'>
                    <legend className='text-sm font-semibold text-[var(--dash-text)]'>Selection mode</legend>
                    <label
                        aria-label='Independent selection mode'
                        className='flex gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] p-3'>
                        <input type='radio' checked={mode === 'independent'} onChange={() => setMode('independent')} />
                        <span>
                            <span className='block text-sm font-semibold text-[var(--dash-text)]'>Independent</span>
                            <span className='text-xs text-[var(--dash-text-muted)]'>
                                Members can hold any combination; clicking again removes a role.
                            </span>
                        </span>
                    </label>
                    <label
                        aria-label='Exclusive selection mode'
                        className='flex gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] p-3'>
                        <input type='radio' checked={mode === 'exclusive'} onChange={() => setMode('exclusive')} />
                        <span>
                            <span className='block text-sm font-semibold text-[var(--dash-text)]'>Exclusive</span>
                            <span className='text-xs text-[var(--dash-text-muted)]'>
                                NeonFlux grants the new choice, then removes the previous panel-owned role.
                            </span>
                        </span>
                    </label>
                </fieldset>

                <section className='space-y-3' aria-label='Role and emoji options'>
                    <div className='flex flex-wrap items-end justify-between gap-3'>
                        <div>
                            <h3 className='text-sm font-semibold text-[var(--dash-text)]'>Role order</h3>
                            <p className='text-xs text-[var(--dash-text-muted)]'>
                                {options.length} / {MAX_REACTION_ROLE_OPTIONS}. This is also the live message order.
                            </p>
                        </div>
                        <div className='flex gap-2'>
                            <button
                                type='button'
                                className={dashboardSecondaryActionClassName}
                                onClick={() =>
                                    setOptions((current) =>
                                        [...current].sort((left, right) => left.roleName.localeCompare(right.roleName))
                                    )
                                }>
                                <SortAsc className='mr-1 inline size-4' /> Sort A–Z
                            </button>
                            <button
                                type='button'
                                className={dashboardSecondaryActionClassName}
                                disabled={options.length >= MAX_REACTION_ROLE_OPTIONS}
                                onClick={addOption}>
                                <Plus className='mr-1 inline size-4' /> Add role
                            </button>
                        </div>
                    </div>
                    {options.map((option, index) => (
                        <div
                            key={option.id}
                            draggable
                            onDragStart={() => setDraggedOptionId(option.id)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => dropOption(event, option.id)}
                            className='grid gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]'>
                            <div className='flex items-center text-[var(--dash-text-subtle)]'>
                                <GripVertical className='size-5' aria-hidden='true' />
                                <span className='sr-only'>Drag option {index + 1}</span>
                            </div>
                            <label className='space-y-1 text-xs font-semibold text-[var(--dash-text-muted)]'>
                                <span>Role</span>
                                <select
                                    className={dashboardFieldClassName}
                                    value={option.roleId}
                                    onChange={(event) => {
                                        const role = query.data.catalog.roles.find(
                                            (candidate) => candidate.id === event.currentTarget.value
                                        );
                                        if (role) {
                                            updateOption(option.id, (current) => ({
                                                ...current,
                                                roleId: role.id,
                                                roleName: role.name,
                                            }));
                                        }
                                    }}>
                                    {query.data.catalog.roles
                                        .filter(
                                            (role) =>
                                                role.eligible &&
                                                (role.id === option.roleId ||
                                                    !options.some((candidate) => candidate.roleId === role.id))
                                        )
                                        .map((role) => (
                                            <option key={role.id} value={role.id}>
                                                {role.name}
                                            </option>
                                        ))}
                                </select>
                            </label>
                            <EmojiEditor
                                emoji={option.emoji}
                                emojis={query.data.catalog.emojis}
                                onChange={(emoji) => updateOption(option.id, (current) => ({ ...current, emoji }))}
                            />
                            <div className='flex items-end gap-1'>
                                <button
                                    type='button'
                                    className={dashboardQuietActionClassName}
                                    disabled={index === 0}
                                    onClick={() => moveOption(option.id, -1)}
                                    aria-label={`Move ${option.roleName} up`}>
                                    <MoveUp className='size-4' />
                                </button>
                                <button
                                    type='button'
                                    className={dashboardQuietActionClassName}
                                    disabled={index === options.length - 1}
                                    onClick={() => moveOption(option.id, 1)}
                                    aria-label={`Move ${option.roleName} down`}>
                                    <MoveDown className='size-4' />
                                </button>
                                <button
                                    type='button'
                                    className={dashboardDangerActionClassName}
                                    onClick={() =>
                                        setOptions((current) =>
                                            current.filter((candidate) => candidate.id !== option.id)
                                        )
                                    }
                                    aria-label={`Remove ${option.roleName}`}>
                                    <X className='size-4' />
                                </button>
                            </div>
                        </div>
                    ))}
                </section>

                {projection.isErr() ? (
                    <DashboardStatus tone='danger'>
                        Fix {projection.error.path.replace('panel.', '')} before saving.
                    </DashboardStatus>
                ) : null}
                {projection.isOk() && draftValidation.isErr() ? (
                    <DashboardStatus tone='danger'>
                        Fix {draftValidation.error.path.replace('panel.', '')} before saving.
                    </DashboardStatus>
                ) : null}
                {notice ? <DashboardStatus tone={notice.tone}>{notice.text}</DashboardStatus> : null}
                <div className='flex flex-wrap gap-2 border-t border-[var(--dash-border)] pt-4'>
                    <button
                        type='button'
                        className={dashboardPrimaryActionClassName}
                        disabled={saveDisabled}
                        onClick={() => mutation.mutate()}>
                        <Save className='mr-1 inline size-4' />{' '}
                        {mutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Publish panel'}
                    </button>
                    {effectiveEditing &&
                    (effectiveEditing.status === 'active' ||
                        effectiveEditing.status === 'degraded' ||
                        effectiveEditing.status === 'unknown') ? (
                        pendingDeactivation ? (
                            <div className='basis-full rounded-[var(--dash-radius-control)] border border-[var(--dash-danger)] p-3'>
                                <p className='text-sm text-[var(--dash-text)]'>
                                    {pendingDeactivation === 'keep'
                                        ? 'Deactivate this panel and remove its reaction controls? The message content will remain when possible.'
                                        : 'Deactivate this panel, delete its message, and revoke only roles this panel granted?'}
                                </p>
                                <div className='mt-3 flex flex-wrap gap-2'>
                                    <button
                                        type='button'
                                        className={dashboardDangerActionClassName}
                                        disabled={deactivateMutation.isPending}
                                        onClick={() =>
                                            deactivateMutation.mutate({
                                                deleteMessage: pendingDeactivation === 'delete-revoke',
                                                revokeOwnedRoles: pendingDeactivation === 'delete-revoke',
                                            })
                                        }>
                                        {deactivateMutation.isPending ? 'Queuing…' : 'Confirm deactivation'}
                                    </button>
                                    <button
                                        type='button'
                                        className={dashboardQuietActionClassName}
                                        disabled={deactivateMutation.isPending}
                                        onClick={() => setPendingDeactivation(undefined)}>
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <button
                                    type='button'
                                    className={dashboardDangerActionClassName}
                                    disabled={deactivateMutation.isPending}
                                    onClick={() => setPendingDeactivation('keep')}>
                                    <Trash2 className='mr-1 inline size-4' /> Deactivate, keep message
                                </button>
                                <button
                                    type='button'
                                    className={dashboardDangerActionClassName}
                                    disabled={deactivateMutation.isPending}
                                    onClick={() => setPendingDeactivation('delete-revoke')}>
                                    Deactivate, delete, revoke
                                </button>
                            </>
                        )
                    ) : null}
                </div>
            </DashboardSurface>

            <aside className='min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start'>
                <DashboardPostingPreview
                    channelLabel={channels.find((channel) => channel.id === channelId)?.name}
                    channels={channels}
                    content={projection.isOk() ? (projection.value.message.content ?? '') : content}
                    embeds={projection.isOk() ? projection.value.message.embeds : embeds}
                    emojis={query.data.catalog.emojis}
                    roles={roles}
                />
                <DashboardSurface tone='glass' padding='compact'>
                    <h3 className='text-sm font-semibold text-[var(--dash-text)]'>Safety contract</h3>
                    <ul className='mt-2 space-y-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        <li>Privileged, protected, and higher roles are unavailable.</li>
                        <li>Each role and emoji may appear once per panel.</li>
                        <li>Only roles granted by this panel are automatically revoked.</li>
                        <li>Updates preserve order in both the legend and behavior.</li>
                    </ul>
                </DashboardSurface>
            </aside>
        </div>
    );
}

function EmojiEditor({
    emoji,
    emojis,
    onChange,
}: {
    emoji: ReactionRoleEmoji;
    emojis: Array<{ animated: boolean; id: string; markup: string; name: string; url: string }>;
    onChange: (emoji: ReactionRoleEmoji) => void;
}) {
    const selectValue = emoji.kind === 'custom' ? `custom:${emoji.id}` : 'unicode';
    return (
        <label className='space-y-1 text-xs font-semibold text-[var(--dash-text-muted)]'>
            <span>Emoji</span>
            <div className='grid grid-cols-[minmax(0,1fr)_5rem] gap-2'>
                <select
                    className={dashboardFieldClassName}
                    value={selectValue}
                    onChange={(event) => {
                        if (event.currentTarget.value === 'unicode') {
                            onChange({ kind: 'unicode', value: '✨' });
                            return;
                        }
                        const selected = emojis.find(
                            (candidate) => `custom:${candidate.id}` === event.currentTarget.value
                        );
                        if (selected) {
                            onChange({
                                animated: selected.animated,
                                id: selected.id,
                                kind: 'custom',
                                name: selected.name,
                            });
                        }
                    }}>
                    <option value='unicode'>Unicode</option>
                    {emojis.map((candidate) => (
                        <option key={candidate.id} value={`custom:${candidate.id}`}>
                            {candidate.name}
                        </option>
                    ))}
                </select>
                <input
                    className={dashboardFieldClassName}
                    value={emoji.kind === 'unicode' ? emoji.value : emoji.name}
                    disabled={emoji.kind === 'custom'}
                    maxLength={32}
                    aria-label='Unicode emoji'
                    onChange={(event) => onChange({ kind: 'unicode', value: event.currentTarget.value })}
                />
            </div>
        </label>
    );
}

function toPostingChannels(
    channels: Array<{
        id: string;
        name: string;
        parentId: string | null;
        parentName: string | null;
        position: number | null;
    }>
): DashboardPostingChannel[] {
    return channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: 0,
        ...(channel.parentId ? { parentId: channel.parentId } : {}),
        ...(channel.parentName ? { parentName: channel.parentName } : {}),
        ...(channel.position === null ? {} : { position: channel.position }),
    }));
}

function toPostingRoles(roles: Array<{ color: number; id: string; name: string }>): DashboardPostingRole[] {
    return roles.map((role) => ({ color: role.color, id: role.id, name: role.name }));
}

function formatPanelAttention(errorCode: string): string {
    switch (errorCode) {
        case 'managed_message_deleted':
            return 'The managed message was deleted. Save the panel to recreate it.';
        case 'send_outcome_unknown':
        case 'send_outcome_unknown_after_restart':
            return 'Message delivery needs manual review.';
        case 'all_reactions_removed_review_required':
            return 'All reactions were removed.';
        case 'reaction_emoji_removed_review_required':
            return 'A configured reaction was removed.';
        default:
            return 'This panel needs attention. Open its details to see what failed and what to do next.';
    }
}

function formatPanelStatus(status: StoredPanel['status']): string {
    switch (status) {
        case 'publishing':
            return 'Publishing';
        case 'active':
            return 'Active';
        case 'updating':
            return 'Updating';
        case 'deactivating':
            return 'Deactivating';
        case 'degraded':
            return 'Needs attention';
        case 'unknown':
            return 'Delivery unknown';
        case 'inactive':
            return 'Inactive';
    }
}

function formatPanelWriteError(type: string, action: 'deactivate' | 'save'): string {
    const actionLabel = action === 'save' ? 'saving this panel' : 'deactivating this panel';
    switch (type) {
        case 'auth-required':
            return `Sign in again before ${actionLabel}.`;
        case 'not-found':
            return 'This panel or server is no longer available. Refresh the page.';
        case 'deployment-config-not-found':
            return `NeonFlux deployment settings are missing. Run the deployment setup before ${actionLabel}.`;
        case 'database-error':
            return `NeonFlux could not update the panel in Convex. Check the deployment before ${actionLabel} again.`;
        case 'guild-lookup-failed':
            return `NeonFlux could not verify this server with Fluxer. Check the bot connection and permissions before ${actionLabel} again.`;
        case 'bot-token-missing':
            return `NeonFlux cannot authenticate with the bot service. Check the bot and web service keys before ${actionLabel}.`;
        default:
            return `NeonFlux could not finish ${actionLabel}. Try again.`;
    }
}
