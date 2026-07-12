import { arrayMove } from '@dnd-kit/sortable';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import {
    publishDashboardReactionRoleMessageRouteData,
    saveDashboardReactionRoleMessageRouteData,
} from '../server/dashboard-reaction-roles-route-data.js';
import type {
    DashboardReactionRoleChannel,
    DashboardReactionRoleEmoji,
    DashboardReactionRoleMessage,
    DashboardReactionRoleMode,
    DashboardReactionRoleRole,
} from '../server/dashboard-reaction-roles.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';
import {
    DashboardEmbedBuilder,
    createEmptyDashboardEmbedDraft,
    normalizeDashboardEmbedDraft,
} from './dashboard-embed-builder.js';
import type { DashboardEmbedDraft } from './dashboard-embed-builder.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardInlineVariants,
    dashboardTactile,
    dashboardViewTransition,
} from './dashboard-motion.js';
import { DashboardPostingPreview } from './dashboard-posting-preview.js';
import {
    getReactionRoleEditorMessageTone,
    getReactionRoleSaveErrorMessage,
    reactionRoleEditorFieldClassName,
    reactionRolePrimaryButtonClassName,
    reactionRoleSecondaryButtonClassName,
} from './dashboard-reaction-role-editor-ui.js';
import {
    EmojiPicker,
    ReactionRoleOptionList,
    RolePicker,
    SegmentedControl,
} from './dashboard-reaction-role-controls.js';
import type { ReactionRoleBuilderOption } from './dashboard-reaction-role-controls.js';
import { DashboardStatus } from './dashboard-ui.js';

type ReactionRoleEditorMode = { type: 'create' } | { type: 'edit'; message: DashboardReactionRoleMessage };
type ReactionRoleMessageType = 'plain' | 'embed';
type EditorMessage = { type: 'success' | 'warning' | 'error'; text: string };

type ReactionRoleDraft = {
    selectedChannelId: string;
    channelSearch: string;
    mode: DashboardReactionRoleMode;
    messageType: ReactionRoleMessageType;
    content: string;
    embedDraft: DashboardEmbedDraft;
    generateOverview: boolean;
    options: ReactionRoleBuilderOption[];
};

const maxReactionRoleOptions = 30;

export function ReactionRoleEditor({
    guildId,
    editorMode,
    channels,
    roles,
    emojis,
    onCancel,
    onSaved,
}: {
    guildId: string;
    editorMode: ReactionRoleEditorMode;
    channels: DashboardReactionRoleChannel[];
    roles: DashboardReactionRoleRole[];
    emojis: DashboardReactionRoleEmoji[];
    onCancel: () => void;
    onSaved: (message: EditorMessage) => Promise<void>;
}) {
    const [draft, setDraft] = useState<ReactionRoleDraft>(() => createInitialDraft(editorMode, channels, roles));
    const [channelPickerOpen, setChannelPickerOpen] = useState(false);
    const [selectedEmoji, setSelectedEmoji] = useState<DashboardReactionRoleEmoji>();
    const [selectedRole, setSelectedRole] = useState<DashboardReactionRoleRole>();
    const [editorMessage, setEditorMessage] = useState<EditorMessage>();
    const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
    const embedResult =
        draft.messageType === 'embed' ? normalizeDashboardEmbedDraft(draft.embedDraft) : { valid: true as const };
    const baseEmbeds = embedResult.valid && embedResult.embed ? [embedResult.embed] : [];
    const preview = buildReactionRolePreview({
        content: draft.messageType === 'plain' ? draft.content : '',
        embeds: baseEmbeds,
        generateOverview: draft.generateOverview,
        options: draft.options,
        roles,
    });
    const saveMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                guildId,
                idempotencyKey,
                ...(draft.messageType === 'plain' && draft.content.trim() ? { content: draft.content.trim() } : {}),
                embeds: baseEmbeds,
                mode: draft.mode,
                generateOverview: draft.generateOverview,
                options: draft.options.map((option, index) => ({
                    emojiKey: option.emojiKey,
                    emojiLabel: option.emojiLabel,
                    roleId: option.roleId,
                    position: index,
                })),
            };

            if (editorMode.type === 'edit') {
                return saveDashboardReactionRoleMessageRouteData({
                    data: {
                        ...payload,
                        expectedRevision: editorMode.message.revision,
                        messageId: editorMode.message.messageId,
                    },
                });
            }

            return publishDashboardReactionRoleMessageRouteData({
                data: {
                    ...payload,
                    channelId: draft.selectedChannelId,
                },
            });
        },
        onSuccess: async (result) => {
            if (result.type === 'operation-accepted' || result.type === 'operation-existing') {
                const message: EditorMessage = {
                    type: 'success',
                    text:
                        editorMode.type === 'create'
                            ? 'Menu publish queued. It will appear when Fluxer confirms it.'
                            : 'Menu synchronization queued. It remains disabled until complete.',
                };

                setEditorMessage(message);
                await onSaved(message);
                return;
            }

            setEditorMessage({
                type: 'error',
                text: getReactionRoleSaveErrorMessage(
                    result.type,
                    result.type === 'invalid-input' ? result.message : undefined
                ),
            });
        },
        onError: () => setEditorMessage({ type: 'error', text: 'Could not save this reaction-role menu.' }),
    });

    function updateDraft(update: Partial<ReactionRoleDraft>): void {
        setDraft((currentDraft) => ({ ...currentDraft, ...update }));
        setIdempotencyKey(crypto.randomUUID());
    }

    function addOption(): void {
        if (!selectedEmoji || !selectedRole || draft.options.length >= maxReactionRoleOptions) return;
        if (draft.options.some((option) => option.emojiKey === selectedEmoji.key)) {
            setEditorMessage({ type: 'error', text: 'Each emoji can only appear once on this menu.' });
            return;
        }
        if (draft.options.some((option) => option.roleId === selectedRole.id)) {
            setEditorMessage({ type: 'error', text: 'Each role can only appear once on this menu.' });
            return;
        }

        updateDraft({
            options: [
                ...draft.options,
                { emojiKey: selectedEmoji.key, emojiLabel: selectedEmoji.label, roleId: selectedRole.id },
            ],
        });
        setSelectedEmoji(undefined);
        setSelectedRole(undefined);
        setEditorMessage(undefined);
    }

    function sortOptionsAlphabetically(): void {
        const roleById = new Map(roles.map((role) => [role.id, role]));

        updateDraft({
            options: [...draft.options].sort((left, right) => {
                const leftRole = roleById.get(left.roleId)?.name ?? left.roleId;
                const rightRole = roleById.get(right.roleId)?.name ?? right.roleId;
                const roleComparison = leftRole.localeCompare(rightRole, undefined, { sensitivity: 'base' });

                return roleComparison === 0
                    ? left.emojiLabel.localeCompare(right.emojiLabel, undefined, { sensitivity: 'base' })
                    : roleComparison;
            }),
        });
    }

    function submit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();

        if (!embedResult.valid) {
            setEditorMessage({ type: 'error', text: embedResult.message });
            return;
        }

        if (editorMode.type === 'create' && !draft.selectedChannelId) {
            setEditorMessage({ type: 'error', text: 'Choose a channel before saving.' });
            return;
        }

        if (draft.options.length === 0) {
            setEditorMessage({ type: 'error', text: 'Add at least one emoji and role option.' });
            return;
        }

        if (!preview.content && preview.embeds.length === 0) {
            setEditorMessage({ type: 'error', text: 'Add message content, an embed, or generated overview.' });
            return;
        }

        saveMutation.mutate();
    }

    return (
        <form
            className='grid min-w-0 gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]'
            aria-label={editorMode.type === 'edit' ? 'Edit reaction-role menu' : 'Create reaction-role menu'}
            onSubmit={submit}
            aria-busy={saveMutation.isPending}>
            <div className='flex flex-wrap items-start justify-between gap-3 xl:col-span-2'>
                <div>
                    <h4
                        id='dashboard-reaction-role-menus-heading'
                        className='text-base font-semibold text-[var(--dash-text)]'>
                        {editorMode.type === 'edit' ? 'Edit reaction-role menu' : 'Create reaction-role menu'}
                    </h4>
                    <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                        Build the message and role mapping, then preview it before publishing.
                    </p>
                </div>
                <motion.button
                    type='button'
                    onClick={onCancel}
                    className={reactionRoleSecondaryButtonClassName}
                    {...dashboardTactile}>
                    Cancel
                </motion.button>
            </div>

            <div className='min-w-0 space-y-6'>
                <section className='space-y-4' aria-label='Reaction-role message'>
                    <div className='space-y-1 border-b border-[var(--dash-border)] pb-3'>
                        <h5 className='text-sm font-semibold text-[var(--dash-text)]'>Message</h5>
                        <p className='text-xs leading-5 text-[var(--dash-text-muted)]'>
                            This is the message members will react to.
                        </p>
                    </div>
                    {editorMode.type === 'create' ? (
                        <DashboardChannelPicker
                            channels={channels}
                            hasError={false}
                            isLoading={false}
                            isOpen={channelPickerOpen}
                            listboxId='reaction-role-channel-options'
                            search={draft.channelSearch}
                            selectedChannelId={draft.selectedChannelId}
                            onBlur={() => setChannelPickerOpen(false)}
                            onFocus={() => setChannelPickerOpen(true)}
                            onSearchChange={(search) => {
                                updateDraft({ channelSearch: search, selectedChannelId: '' });
                                setChannelPickerOpen(true);
                            }}
                            onSelect={(channel) => {
                                updateDraft({
                                    selectedChannelId: channel.id,
                                    channelSearch: formatDashboardChannelLabel(channel),
                                });
                                setChannelPickerOpen(false);
                            }}
                        />
                    ) : (
                        <div className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 py-2 text-sm text-[var(--dash-text-muted)]'>
                            Channel:{' '}
                            <span className='font-medium text-[var(--dash-text)]'>
                                {editorMode.message.channelName
                                    ? `#${editorMode.message.channelName}`
                                    : editorMode.message.channelId}
                            </span>
                        </div>
                    )}
                    <SegmentedControl
                        label='Message type'
                        value={draft.messageType}
                        options={[
                            { value: 'plain', label: 'Plain text' },
                            { value: 'embed', label: 'Embed' },
                        ]}
                        onChange={(value) => updateDraft({ messageType: value as ReactionRoleMessageType })}
                    />
                    <AnimatePresence initial={false} mode='popLayout'>
                        {draft.messageType === 'plain' ? (
                            <motion.label
                                key='plain'
                                data-dashboard-motion='view-change'
                                className='block space-y-2 text-sm font-medium text-[var(--dash-text)]'
                                variants={dashboardInlineVariants}
                                initial='initial'
                                animate='enter'
                                exit='exit'
                                transition={dashboardViewTransition}>
                                <span>Message content</span>
                                <textarea
                                    value={draft.content}
                                    onChange={(event) => updateDraft({ content: event.currentTarget.value })}
                                    className={reactionRoleEditorFieldClassName}
                                    placeholder='Pick your roles:{list}'
                                />
                            </motion.label>
                        ) : (
                            <motion.div
                                key='embed'
                                data-dashboard-motion='view-change'
                                variants={dashboardInlineVariants}
                                initial='initial'
                                animate='enter'
                                exit='exit'
                                transition={dashboardViewTransition}>
                                <DashboardEmbedBuilder
                                    draft={draft.embedDraft}
                                    onDraftChange={(embedDraft) => updateDraft({ embedDraft })}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <label className='inline-flex min-h-10 items-center gap-3 text-sm font-medium text-[var(--dash-text)]'>
                        <input
                            type='checkbox'
                            checked={draft.generateOverview}
                            onChange={(event) => updateDraft({ generateOverview: event.currentTarget.checked })}
                            className='size-4 accent-[var(--dash-primary)]'
                        />
                        Generate the emoji-to-role overview
                    </label>
                </section>

                <section className='space-y-3' aria-label='Reaction-role mode'>
                    <SegmentedControl
                        label='Assignment mode'
                        value={draft.mode}
                        options={[
                            { value: 'normal', label: 'Normal' },
                            { value: 'exclusive', label: 'Exclusive' },
                        ]}
                        onChange={(value) => updateDraft({ mode: value as DashboardReactionRoleMode })}
                    />
                </section>

                <section
                    className='space-y-4 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] p-3'
                    aria-label='Reaction-role options'>
                    <div>
                        <h5 className='text-sm font-semibold text-[var(--dash-text)]'>Emoji and role options</h5>
                        <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                            Each emoji and role may appear once. Drag options to set their display order.
                        </p>
                    </div>
                    <div className='flex flex-wrap items-end gap-3'>
                        <EmojiPicker emojis={emojis} selected={selectedEmoji} onSelect={setSelectedEmoji} />
                        <RolePicker roles={roles} selected={selectedRole} onSelect={setSelectedRole} />
                        <motion.button
                            type='button'
                            onClick={addOption}
                            disabled={!selectedEmoji || !selectedRole || draft.options.length >= maxReactionRoleOptions}
                            className={reactionRolePrimaryButtonClassName}
                            {...dashboardTactile}>
                            Add option
                        </motion.button>
                        <motion.button
                            type='button'
                            onClick={sortOptionsAlphabetically}
                            disabled={draft.options.length < 2}
                            className={reactionRoleSecondaryButtonClassName}
                            {...dashboardTactile}>
                            Sort alphabetically
                        </motion.button>
                    </div>
                    <ReactionRoleOptionList
                        options={draft.options}
                        roles={roles}
                        onRemove={(index) =>
                            updateDraft({ options: draft.options.filter((_, optionIndex) => optionIndex !== index) })
                        }
                        onReorder={(fromIndex, toIndex) =>
                            updateDraft({ options: arrayMove(draft.options, fromIndex, toIndex) })
                        }
                    />
                </section>
            </div>

            <aside className='min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start' aria-label='Menu preview and save'>
                <DashboardPostingPreview content={preview.content ?? ''} embeds={preview.embeds} />
                <div className='rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] p-4'>
                    <motion.button
                        type='submit'
                        disabled={saveMutation.isPending}
                        className={reactionRolePrimaryButtonClassName}
                        {...dashboardTactile}>
                        {saveMutation.isPending
                            ? 'Saving…'
                            : editorMode.type === 'create'
                              ? 'Publish menu'
                              : 'Save changes'}
                    </motion.button>
                    <AnimatePresence initial={false} mode='popLayout'>
                        {editorMessage ? (
                            <motion.div
                                key={`${editorMessage.type}:${editorMessage.text}`}
                                data-dashboard-motion='confirmation'
                                className='mt-3'
                                variants={dashboardConfirmationVariants}
                                initial='initial'
                                animate='enter'
                                transition={dashboardConfirmationTransition}>
                                <DashboardStatus tone={getReactionRoleEditorMessageTone(editorMessage.type)}>
                                    {editorMessage.text}
                                </DashboardStatus>
                            </motion.div>
                        ) : (
                            <motion.p
                                key='save-help'
                                data-dashboard-motion='confirmation'
                                className='mt-3 text-xs leading-5 text-[var(--dash-text-subtle)]'
                                variants={dashboardConfirmationVariants}
                                initial='initial'
                                animate='enter'
                                transition={dashboardConfirmationTransition}>
                                Members cannot use this menu until Fluxer confirms synchronization.
                            </motion.p>
                        )}
                    </AnimatePresence>
                </div>
            </aside>
        </form>
    );
}

function createInitialDraft(
    editorMode: ReactionRoleEditorMode,
    channels: DashboardReactionRoleChannel[],
    roles: DashboardReactionRoleRole[]
): ReactionRoleDraft {
    if (editorMode.type === 'create') {
        return {
            selectedChannelId: '',
            channelSearch: '',
            mode: 'normal',
            messageType: 'plain',
            content: '',
            embedDraft: createEmptyDashboardEmbedDraft(),
            generateOverview: true,
            options: [],
        };
    }

    const channel = channels.find((candidate) => candidate.id === editorMode.message.channelId);
    const options = editorMode.message.options.map((option) => ({
        emojiKey: option.emojiKey,
        emojiLabel: option.emojiLabel ?? option.emojiKey,
        roleId: option.roleId,
    }));
    const legend = buildStoredOverviewLegend(options, roles);
    const hasEmbed = editorMode.message.messageEmbeds.length > 0;
    const embedDraft = hasEmbed
        ? embedPayloadToDraft(editorMode.message.messageEmbeds[0] ?? {}, legend, editorMode.message.generateOverview)
        : createEmptyDashboardEmbedDraft();

    return {
        selectedChannelId: editorMode.message.channelId,
        channelSearch: channel ? formatDashboardChannelLabel(channel) : editorMode.message.channelId,
        mode: editorMode.message.mode,
        messageType: hasEmbed ? 'embed' : 'plain',
        content:
            editorMode.message.generateOverview && editorMode.message.messageContent
                ? restoreOverviewPlaceholder(editorMode.message.messageContent, legend)
                : (editorMode.message.messageContent ?? ''),
        embedDraft,
        generateOverview: editorMode.message.generateOverview,
        options,
    };
}

function buildReactionRolePreview({
    content,
    embeds,
    generateOverview,
    options,
    roles,
}: {
    content: string;
    embeds: unknown[];
    generateOverview: boolean;
    options: ReactionRoleBuilderOption[];
    roles: DashboardReactionRoleRole[];
}): { content?: string; embeds: unknown[] } {
    if (!generateOverview || options.length === 0) {
        return { ...(content.trim() ? { content: content.trim() } : {}), embeds };
    }

    const legend = buildStoredOverviewLegend(options, roles);

    if (content.includes('{list}')) {
        return { content: content.replaceAll('{list}', legend).trim(), embeds };
    }

    const clonedEmbeds = embeds.map((embed) => ({ ...(embed as Record<string, unknown>) }));
    if (clonedEmbeds.length > 0) {
        const firstEmbed = clonedEmbeds[0] as Record<string, unknown>;
        const description = typeof firstEmbed.description === 'string' ? firstEmbed.description : '';
        firstEmbed.description = description.includes('{list}')
            ? description.replaceAll('{list}', legend)
            : [description.trim(), legend].filter(Boolean).join('\n\n');

        return { ...(content.trim() ? { content: content.trim() } : {}), embeds: clonedEmbeds };
    }

    return { content: content.trim() ? `${content.trim()}\n\n${legend}` : legend, embeds };
}

function buildStoredOverviewLegend(options: ReactionRoleBuilderOption[], roles: DashboardReactionRoleRole[]): string {
    const roleById = new Map(roles.map((role) => [role.id, role]));

    return options
        .map((option) => {
            const role = roleById.get(option.roleId);
            const roleLabel = role ? `<@&${role.id}> (${role.name})` : option.roleId;

            return `${option.emojiLabel} - ${roleLabel}`;
        })
        .join('\n');
}

function restoreOverviewPlaceholder(value: string, legend: string): string {
    if (!legend || !value.includes(legend)) return value;

    return value.replace(legend, '{list}');
}

function embedPayloadToDraft(
    embed: Record<string, unknown>,
    legend: string,
    generateOverview: boolean
): DashboardEmbedDraft {
    const draft = createEmptyDashboardEmbedDraft();
    const author = toRecord(embed.author);
    const thumbnail = toRecord(embed.thumbnail);
    const image = toRecord(embed.image);
    const footer = toRecord(embed.footer);
    const color = typeof embed.color === 'number' ? embed.color : undefined;
    const description = typeof embed.description === 'string' ? embed.description : '';

    return {
        ...draft,
        sidebarColor: color === undefined ? draft.sidebarColor : `#${color.toString(16).padStart(6, '0')}`,
        authorName: typeof author?.name === 'string' ? author.name : '',
        authorIconUrl: typeof author?.icon_url === 'string' ? author.icon_url : '',
        authorUrl: typeof author?.url === 'string' ? author.url : '',
        title: typeof embed.title === 'string' ? embed.title : '',
        titleUrl: typeof embed.url === 'string' ? embed.url : '',
        description: generateOverview ? restoreOverviewPlaceholder(description, legend) : description,
        thumbnailUrl: typeof thumbnail?.url === 'string' ? thumbnail.url : '',
        imageUrl: typeof image?.url === 'string' ? image.url : '',
        footerText: typeof footer?.text === 'string' ? footer.text : '',
        footerIconUrl: typeof footer?.icon_url === 'string' ? footer.icon_url : '',
        includeTimestamp: typeof embed.timestamp === 'string',
    };
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}
