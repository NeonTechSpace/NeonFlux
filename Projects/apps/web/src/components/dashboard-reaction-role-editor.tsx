import { arrayMove } from '@dnd-kit/sortable';
import { useMutation } from '@tanstack/react-query';
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
import { DashboardPostingPreview } from './dashboard-posting-preview.js';
import {
    EmojiPicker,
    ReactionRoleOptionList,
    RolePicker,
    SegmentedControl,
} from './dashboard-reaction-role-controls.js';
import type { ReactionRoleBuilderOption } from './dashboard-reaction-role-controls.js';

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
            if (
                result.type === 'published' ||
                result.type === 'saved' ||
                result.type === 'published-with-seed-errors' ||
                result.type === 'saved-with-reaction-errors'
            ) {
                const message: EditorMessage = {
                    type:
                        result.type === 'published-with-seed-errors' || result.type === 'saved-with-reaction-errors'
                            ? 'warning'
                            : 'success',
                    text:
                        result.type === 'published' || result.type === 'published-with-seed-errors'
                            ? getPublishSuccessMessage(result.type)
                            : getSaveSuccessMessage(result.type),
                };

                setEditorMessage(message);
                await onSaved(message);
                return;
            }

            setEditorMessage({
                type: 'error',
                text: getSaveErrorMessage(result.type, result.type === 'invalid-input' ? result.message : undefined),
            });
        },
        onError: () => setEditorMessage({ type: 'error', text: 'Could not save this reaction-role menu.' }),
    });

    function updateDraft(update: Partial<ReactionRoleDraft>): void {
        setDraft((currentDraft) => ({ ...currentDraft, ...update }));
    }

    function addOption(): void {
        if (!selectedEmoji || !selectedRole || draft.options.length >= maxReactionRoleOptions) return;
        if (draft.options.some((option) => option.emojiKey === selectedEmoji.key)) {
            setEditorMessage({ type: 'error', text: 'Each emoji can only appear once on this menu.' });
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
            className='space-y-6 p-4'
            aria-label={editorMode.type === 'edit' ? 'Edit reaction-role menu' : 'Create reaction-role menu'}
            onSubmit={submit}
            aria-busy={saveMutation.isPending}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h4 className='text-base font-semibold text-white'>
                        {editorMode.type === 'edit' ? 'Edit reaction-role menu' : 'Create reaction-role menu'}
                    </h4>
                    <p className='mt-1 text-sm leading-6 text-neutral-400'>Changes are local until you save them.</p>
                </div>
                <button
                    type='button'
                    onClick={onCancel}
                    className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-neutral-500'>
                    Cancel
                </button>
            </div>

            <section className='space-y-4' aria-label='Reaction-role message'>
                <div className='space-y-1'>
                    <h5 className='text-sm font-semibold text-neutral-100'>Message</h5>
                    <p className='text-xs leading-5 text-neutral-500'>This is the message users will react to.</p>
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
                    <div className='rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300'>
                        Channel:{' '}
                        {editorMode.message.channelName
                            ? `#${editorMode.message.channelName}`
                            : editorMode.message.channelId}
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
                {draft.messageType === 'plain' ? (
                    <label className='space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Message content</span>
                        <textarea
                            value={draft.content}
                            onChange={(event) => updateDraft({ content: event.currentTarget.value })}
                            className='min-h-32 w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='Pick your roles:{list}'
                        />
                    </label>
                ) : (
                    <DashboardEmbedBuilder
                        draft={draft.embedDraft}
                        onDraftChange={(embedDraft) => updateDraft({ embedDraft })}
                    />
                )}
                <label className='inline-flex min-h-10 items-center gap-3 text-sm font-medium text-neutral-200'>
                    <input
                        type='checkbox'
                        checked={draft.generateOverview}
                        onChange={(event) => updateDraft({ generateOverview: event.currentTarget.checked })}
                        className='size-4 accent-sky-400'
                    />
                    Generate overview
                </label>
                <DashboardPostingPreview content={preview.content ?? ''} embeds={preview.embeds} />
            </section>

            <section className='space-y-3' aria-label='Reaction-role mode'>
                <SegmentedControl
                    label='Mode'
                    value={draft.mode}
                    options={[
                        { value: 'normal', label: 'Normal' },
                        { value: 'exclusive', label: 'Exclusive' },
                    ]}
                    onChange={(value) => updateDraft({ mode: value as DashboardReactionRoleMode })}
                />
            </section>

            <section
                className='space-y-4 rounded-md border border-neutral-800 bg-neutral-950 p-3'
                aria-label='Reaction-role options'>
                <div className='flex flex-wrap items-end gap-3'>
                    <EmojiPicker emojis={emojis} selected={selectedEmoji} onSelect={setSelectedEmoji} />
                    <RolePicker roles={roles} selected={selectedRole} onSelect={setSelectedRole} />
                    <button
                        type='button'
                        onClick={addOption}
                        disabled={!selectedEmoji || !selectedRole || draft.options.length >= maxReactionRoleOptions}
                        className='min-h-10 rounded-md bg-sky-500 px-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Add option
                    </button>
                    <button
                        type='button'
                        onClick={sortOptionsAlphabetically}
                        disabled={draft.options.length < 2}
                        className='min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:text-neutral-500'>
                        Sort alphabetically
                    </button>
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

            <div className='flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-4'>
                <button
                    type='submit'
                    disabled={saveMutation.isPending}
                    className='min-h-10 rounded-md bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                    {saveMutation.isPending ? 'Saving...' : 'Save changes'}
                </button>
                <span role='status' className={getEditorMessageClassName(editorMessage?.type)}>
                    {editorMessage?.text}
                </span>
            </div>
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

function getPublishSuccessMessage(type: 'published' | 'published-with-seed-errors'): string {
    return type === 'published'
        ? 'Reaction-role menu published.'
        : 'Menu published, but one or more seed reactions could not be added.';
}

function getSaveSuccessMessage(type: 'saved' | 'saved-with-reaction-errors'): string {
    return type === 'saved'
        ? 'Reaction-role menu saved.'
        : 'Menu saved, but one or more reactions could not be synced.';
}

function getSaveErrorMessage(type: string, message?: string): string {
    if (message) return message;

    switch (type) {
        case 'invalid-input':
            return 'Check the message, emoji, and role options before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'bot-token-missing':
            return 'Reaction-role editing is not configured for this deployment.';
        case 'edit-failed':
            return 'Fluxer could not edit this reaction-role message.';
        case 'send-failed':
            return 'Fluxer could not publish this menu.';
        case 'not-found':
            return 'This reaction-role menu is not available anymore.';
        default:
            return 'Could not save this reaction-role menu.';
    }
}

function getEditorMessageClassName(type: EditorMessage['type'] | undefined): string {
    switch (type) {
        case 'success':
            return 'text-sm text-emerald-300';
        case 'warning':
            return 'text-sm text-amber-300';
        case 'error':
            return 'text-sm text-rose-300';
        default:
            return 'text-sm text-neutral-400';
    }
}
