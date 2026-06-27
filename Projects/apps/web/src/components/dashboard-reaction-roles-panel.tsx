import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardReactionRolesSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardReactionRoleMessageRouteData,
    deleteDashboardReactionRoleOptionRouteData,
    readDashboardReactionRolesSettingsRouteData,
    updateDashboardReactionRoleMessageRouteData,
    updateDashboardReactionRoleOptionRouteData,
} from '../server/dashboard-reaction-roles-route-data.js';
import type {
    DashboardReactionRoleMessage,
    DashboardReactionRoleRole,
} from '../server/dashboard-reaction-roles.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';

export function DashboardReactionRolesPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
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

    async function invalidateSettings(): Promise<void> {
        await queryClient.invalidateQueries({
            queryKey: getDashboardReactionRolesSettingsQueryKey(guildId),
        });
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

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Reaction roles</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Grant roles when members react to configured messages. NeonFlux skips roles it cannot safely manage.
                </p>
            </div>
            {settingsQuery.data.structureReadStatus === 'bot-token-missing' ? (
                <p className='border-b border-neutral-800 px-4 py-3 text-sm leading-6 text-rose-300'>
                    Set FLUXER_BOT_TOKEN for the web service to load channels and roles.
                </p>
            ) : null}
            {settingsQuery.data.structureReadStatus === 'fetch-failed' ? (
                <p className='border-b border-neutral-800 px-4 py-3 text-sm leading-6 text-rose-300'>
                    Could not read server channels or roles.
                </p>
            ) : null}
            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <ReactionRoleEditors
                    guildId={guildId}
                    channels={settingsQuery.data.channels}
                    roles={settingsQuery.data.roles}
                    messages={settingsQuery.data.messages}
                    onChanged={invalidateSettings}
                />
                <ReactionRoleMessageList
                    guildId={guildId}
                    messages={settingsQuery.data.messages}
                    roles={settingsQuery.data.roles}
                    onChanged={invalidateSettings}
                />
            </div>
        </article>
    );
}

function ReactionRoleEditors({
    guildId,
    channels,
    roles,
    messages,
    onChanged,
}: {
    guildId: string;
    channels: Parameters<typeof DashboardChannelPicker>[0]['channels'];
    roles: DashboardReactionRoleRole[];
    messages: DashboardReactionRoleMessage[];
    onChanged: () => Promise<void>;
}) {
    const [channelSearch, setChannelSearch] = useState('');
    const [selectedChannelId, setSelectedChannelId] = useState('');
    const [isChannelOpen, setIsChannelOpen] = useState(false);
    const [messageId, setMessageId] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [removeOnUnreact, setRemoveOnUnreact] = useState(true);
    const [selectedMessageId, setSelectedMessageId] = useState('');
    const [emojiKey, setEmojiKey] = useState('');
    const [roleSearch, setRoleSearch] = useState('');
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [isRoleOpen, setIsRoleOpen] = useState(false);
    const [status, setStatus] = useState<string | undefined>();
    const [isSaving, setIsSaving] = useState(false);
    const selectedRole = roles.find((role) => role.id === selectedRoleId);
    const optionMessageId = selectedMessageId || messages[0]?.messageId || '';

    async function saveMessage(): Promise<void> {
        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await updateDashboardReactionRoleMessageRouteData({
                data: {
                    guildId,
                    channelId: selectedChannelId,
                    messageId,
                    enabled,
                    removeOnUnreact,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toReactionRoleMutationStatus(result.type));
                return;
            }

            setMessageId('');
            setSelectedChannelId('');
            setChannelSearch('');
            setEnabled(true);
            setRemoveOnUnreact(true);
            setSelectedMessageId(result.message.messageId);
            setStatus('Message saved.');
            await onChanged();
        } finally {
            setIsSaving(false);
        }
    }

    async function saveOption(): Promise<void> {
        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await updateDashboardReactionRoleOptionRouteData({
                data: {
                    guildId,
                    messageId: optionMessageId,
                    emojiKey,
                    roleId: selectedRoleId,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toReactionRoleMutationStatus(result.type));
                return;
            }

            setEmojiKey('');
            setSelectedRoleId('');
            setRoleSearch('');
            setStatus('Option saved.');
            await onChanged();
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <section className='space-y-6 p-4' aria-labelledby='reaction-role-editor-heading'>
            <div>
                <h4 id='reaction-role-editor-heading' className='text-sm font-semibold text-white'>
                    Message
                </h4>
                <div className='mt-3 space-y-3'>
                    <DashboardChannelPicker
                        channels={channels}
                        hasError={false}
                        isLoading={false}
                        isOpen={isChannelOpen}
                        listboxId='reaction-role-channel-options'
                        search={channelSearch}
                        selectedChannelId={selectedChannelId}
                        onBlur={() => setIsChannelOpen(false)}
                        onFocus={() => setIsChannelOpen(true)}
                        onSearchChange={(search) => {
                            setChannelSearch(search);
                            setIsChannelOpen(true);
                        }}
                        onSelect={(channel) => {
                            setSelectedChannelId(channel.id);
                            setChannelSearch(formatDashboardChannelLabel(channel));
                            setIsChannelOpen(false);
                        }}
                    />
                    <TextField
                        label='Message ID'
                        value={messageId}
                        placeholder='Discord message ID'
                        onChange={setMessageId}
                    />
                    <div className='grid gap-2 sm:grid-cols-2'>
                        <label className='inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-medium text-neutral-200'>
                            <input
                                type='checkbox'
                                checked={enabled}
                                onChange={(event) => setEnabled(event.currentTarget.checked)}
                                className='size-4 accent-sky-400'
                            />
                            Enabled
                        </label>
                        <label className='inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-medium text-neutral-200'>
                            <input
                                type='checkbox'
                                checked={removeOnUnreact}
                                onChange={(event) => setRemoveOnUnreact(event.currentTarget.checked)}
                                className='size-4 accent-sky-400'
                            />
                            Remove on unreact
                        </label>
                    </div>
                    <button
                        type='button'
                        onClick={() => void saveMessage()}
                        disabled={isSaving || !selectedChannelId || !messageId.trim()}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Save message
                    </button>
                </div>
            </div>
            <div>
                <h4 className='text-sm font-semibold text-white'>Reaction option</h4>
                <div className='mt-3 space-y-3'>
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Message</span>
                        <select
                            value={optionMessageId}
                            onChange={(event) => setSelectedMessageId(event.currentTarget.value)}
                            className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                            {messages.length === 0 ? <option value=''>Save a message first</option> : null}
                            {messages.map((message) => (
                                <option key={message.messageId} value={message.messageId}>
                                    {formatReactionRoleMessageLabel(message)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <TextField
                        label='Emoji key'
                        value={emojiKey}
                        placeholder='unicode:check or custom:name:id'
                        onChange={setEmojiKey}
                    />
                    <RolePicker
                        roles={roles}
                        isOpen={isRoleOpen}
                        search={selectedRole && roleSearch === selectedRole.id ? `@${selectedRole.name}` : roleSearch}
                        selectedRoleId={selectedRoleId}
                        onBlur={() => setIsRoleOpen(false)}
                        onFocus={() => setIsRoleOpen(true)}
                        onSearchChange={(search) => {
                            setRoleSearch(search);
                            setIsRoleOpen(true);
                        }}
                        onSelect={(role) => {
                            setSelectedRoleId(role.id);
                            setRoleSearch(`@${role.name}`);
                            setIsRoleOpen(false);
                        }}
                    />
                    <button
                        type='button'
                        onClick={() => void saveOption()}
                        disabled={isSaving || !optionMessageId || !emojiKey.trim() || !selectedRoleId}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Save option
                    </button>
                </div>
            </div>
            {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
        </section>
    );
}

function ReactionRoleMessageList({
    guildId,
    messages,
    roles,
    onChanged,
}: {
    guildId: string;
    messages: DashboardReactionRoleMessage[];
    roles: DashboardReactionRoleRole[];
    onChanged: () => Promise<void>;
}) {
    const [busyKey, setBusyKey] = useState<string | undefined>();
    const roleNameById = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles]);

    async function deleteMessage(messageId: string): Promise<void> {
        setBusyKey(`message:${messageId}`);
        try {
            await deleteDashboardReactionRoleMessageRouteData({ data: { guildId, messageId } });
            await onChanged();
        } finally {
            setBusyKey(undefined);
        }
    }

    async function deleteOption(messageId: string, emojiKey: string): Promise<void> {
        setBusyKey(`option:${messageId}:${emojiKey}`);
        try {
            await deleteDashboardReactionRoleOptionRouteData({ data: { guildId, messageId, emojiKey } });
            await onChanged();
        } finally {
            setBusyKey(undefined);
        }
    }

    return (
        <section className='p-4' aria-labelledby='reaction-role-list-heading'>
            <h4 id='reaction-role-list-heading' className='text-sm font-semibold text-white'>
                Configured messages
            </h4>
            {messages.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No reaction-role messages are configured yet.</p>
            ) : (
                <div className='mt-3 divide-y divide-neutral-800 rounded-md border border-neutral-800'>
                    {messages.map((message) => (
                        <article key={message.messageId} className='p-3'>
                            <div className='flex flex-wrap items-start justify-between gap-3'>
                                <div className='min-w-0'>
                                    <p className='font-medium text-neutral-100'>
                                        {message.channelName ? `#${message.channelName}` : message.channelId}
                                    </p>
                                    <p className='mt-1 font-mono text-xs text-neutral-500'>
                                        Message {message.messageId}
                                    </p>
                                </div>
                                <div className='flex items-center gap-2 text-xs text-neutral-400'>
                                    <span>{message.enabled ? 'Enabled' : 'Disabled'}</span>
                                    <span>{message.removeOnUnreact ? 'Removes roles' : 'Keeps roles'}</span>
                                </div>
                            </div>
                            <div className='mt-3 flex flex-wrap gap-2'>
                                {message.options.length === 0 ? (
                                    <span className='text-sm text-neutral-500'>No emoji options yet.</span>
                                ) : (
                                    message.options.map((option) => (
                                        <span
                                            key={option.emojiKey}
                                            className='inline-flex items-center gap-2 rounded-md border border-neutral-700 px-2 py-1 text-sm text-neutral-200'>
                                            <span className='font-mono text-xs text-neutral-400'>
                                                {option.emojiKey}
                                            </span>
                                            <span>
                                                @{option.roleName ?? roleNameById.get(option.roleId) ?? option.roleId}
                                            </span>
                                            <button
                                                type='button'
                                                onClick={() => void deleteOption(message.messageId, option.emojiKey)}
                                                disabled={busyKey === `option:${message.messageId}:${option.emojiKey}`}
                                                className='text-xs font-semibold text-neutral-400 transition hover:text-rose-200 disabled:text-neutral-600'>
                                                Remove
                                            </button>
                                        </span>
                                    ))
                                )}
                            </div>
                            <div className='mt-3 text-right'>
                                <button
                                    type='button'
                                    onClick={() => void deleteMessage(message.messageId)}
                                    disabled={busyKey === `message:${message.messageId}`}
                                    className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                    Remove message
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function RolePicker({
    roles,
    isOpen,
    search,
    selectedRoleId,
    onBlur,
    onFocus,
    onSearchChange,
    onSelect,
}: {
    roles: DashboardReactionRoleRole[];
    isOpen: boolean;
    search: string;
    selectedRoleId: string;
    onBlur: () => void;
    onFocus: () => void;
    onSearchChange: (search: string) => void;
    onSelect: (role: DashboardReactionRoleRole) => void;
}) {
    const matchedRoles = matchRoles(roles, search).slice(0, 8);

    return (
        <div className='space-y-2 text-sm font-medium text-neutral-200'>
            <label className='space-y-2'>
                <span>Role</span>
                <input
                    value={search}
                    onBlur={onBlur}
                    onChange={(event) => onSearchChange(event.currentTarget.value)}
                    onFocus={onFocus}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    autoComplete='off'
                    role='combobox'
                    aria-autocomplete='list'
                    aria-controls='reaction-role-role-options'
                    aria-expanded={isOpen}
                    placeholder='Search roles'
                />
            </label>
            {isOpen ? (
                <ul
                    id='reaction-role-role-options'
                    className='max-h-56 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950'
                    role='listbox'>
                    {matchedRoles.length > 0 ? (
                        matchedRoles.map((role) => (
                            <li key={role.id} role='option' aria-selected={selectedRoleId === role.id}>
                                <button
                                    type='button'
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onSelect(role)}
                                    className='flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm text-neutral-100 transition hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none'>
                                    <span className='min-w-0 truncate'>@{role.name}</span>
                                    <span className='shrink-0 font-mono text-xs text-neutral-500'>{role.id}</span>
                                </button>
                            </li>
                        ))
                    ) : (
                        <li className='px-3 py-3 text-sm text-neutral-500'>No matching roles.</li>
                    )}
                </ul>
            ) : null}
        </div>
    );
}

function TextField({
    label,
    value,
    placeholder,
    onChange,
}: {
    label: string;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
            <span>{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                placeholder={placeholder}
            />
        </label>
    );
}

export function DashboardReactionRolesLoading() {
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

function formatReactionRoleMessageLabel(message: DashboardReactionRoleMessage): string {
    return `${message.channelName ? `#${message.channelName}` : message.channelId} / ${message.messageId}`;
}

function matchRoles(roles: DashboardReactionRoleRole[], query: string): DashboardReactionRoleRole[] {
    const normalizedQuery = normalizeSearchText(query);

    if (!normalizedQuery) {
        return roles;
    }

    return roles
        .map((role, index) => ({ role, index, score: scoreRoleMatch(role, normalizedQuery) }))
        .filter((match): match is { role: DashboardReactionRoleRole; index: number; score: number } => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((match) => match.role);
}

function scoreRoleMatch(role: DashboardReactionRoleRole, query: string): number {
    const values = [role.name, role.id, `@${role.name}`].map(normalizeSearchText);
    const tokens = query.split(/\s+/).filter(Boolean);
    let score = 0;

    for (const token of tokens) {
        const tokenScore = Math.max(...values.map((value) => scoreToken(token, value)));

        if (tokenScore === 0) {
            return 0;
        }

        score += tokenScore;
    }

    return score;
}

function scoreToken(token: string, value: string): number {
    if (value === token) return 100;
    if (value.startsWith(token)) return 80;
    if (value.includes(token)) return 60;

    return isSubsequence(token, value) ? 30 : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
    let needleIndex = 0;

    for (const character of haystack) {
        if (character === needle[needleIndex]) {
            needleIndex += 1;
        }

        if (needleIndex === needle.length) {
            return true;
        }
    }

    return false;
}

function normalizeSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^[@#]/, '')
        .replace(/[^a-z0-9]+/g, ' ');
}

function toReactionRoleMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Check the message, emoji, and role fields before saving.';
        case 'not-found':
            return 'The selected message or server is no longer available.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        default:
            return 'Could not save reaction-role settings.';
    }
}
