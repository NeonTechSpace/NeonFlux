import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardVerificationSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardVerificationFlowRouteData,
    readDashboardVerificationSettingsRouteData,
    updateDashboardVerificationFlowRouteData,
} from '../server/dashboard-verification-route-data.js';
import type { DashboardVerificationFlow, DashboardVerificationRole } from '../server/dashboard-verification.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';

export function DashboardVerificationPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const settingsQuery = useQuery({
        queryKey: getDashboardVerificationSettingsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardVerificationSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') {
                throw new Error('Could not load verification settings.');
            }

            return result;
        },
    });

    async function invalidateSettings(): Promise<void> {
        await queryClient.invalidateQueries({
            queryKey: getDashboardVerificationSettingsQueryKey(guildId),
        });
    }

    if (settingsQuery.isPending) {
        return <DashboardVerificationLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Verification</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load verification settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Verification</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Grant a verified role when members react to a configured verification message.
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
                <VerificationFlowEditor
                    guildId={guildId}
                    channels={settingsQuery.data.channels}
                    roles={settingsQuery.data.roles}
                    onChanged={invalidateSettings}
                />
                <VerificationFlowList
                    guildId={guildId}
                    flows={settingsQuery.data.flows}
                    onChanged={invalidateSettings}
                />
            </div>
        </article>
    );
}

function VerificationFlowEditor({
    guildId,
    channels,
    roles,
    onChanged,
}: {
    guildId: string;
    channels: Parameters<typeof DashboardChannelPicker>[0]['channels'];
    roles: DashboardVerificationRole[];
    onChanged: () => Promise<void>;
}) {
    const [channelSearch, setChannelSearch] = useState('');
    const [selectedChannelId, setSelectedChannelId] = useState('');
    const [isChannelOpen, setIsChannelOpen] = useState(false);
    const [messageId, setMessageId] = useState('');
    const [emojiKey, setEmojiKey] = useState('');
    const [roleSearch, setRoleSearch] = useState('');
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [isRoleOpen, setIsRoleOpen] = useState(false);
    const [enabled, setEnabled] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [status, setStatus] = useState<string | undefined>();
    const matchedRoles = useMemo(() => matchRoles(roles, roleSearch).slice(0, 8), [roles, roleSearch]);

    async function saveFlow(): Promise<void> {
        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await updateDashboardVerificationFlowRouteData({
                data: {
                    guildId,
                    channelId: selectedChannelId,
                    messageId,
                    emojiKey,
                    verifiedRoleId: selectedRoleId,
                    enabled,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toVerificationMutationStatus(result.type));
                return;
            }

            setChannelSearch('');
            setSelectedChannelId('');
            setMessageId('');
            setEmojiKey('');
            setRoleSearch('');
            setSelectedRoleId('');
            setEnabled(true);
            setStatus('Verification flow saved.');
            await onChanged();
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <section className='space-y-3 p-4' aria-labelledby='verification-flow-editor-heading'>
            <h4 id='verification-flow-editor-heading' className='text-sm font-semibold text-white'>
                Flow
            </h4>
            <DashboardChannelPicker
                channels={channels}
                hasError={false}
                isLoading={false}
                isOpen={isChannelOpen}
                listboxId='verification-channel-options'
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
            <TextField label='Message ID' value={messageId} placeholder='Discord message ID' onChange={setMessageId} />
            <TextField label='Emoji key' value={emojiKey} placeholder='unicode:✅ or emoji:id' onChange={setEmojiKey} />
            <RolePicker
                roles={roles}
                matchedRoles={matchedRoles}
                isOpen={isRoleOpen}
                search={roleSearch}
                selectedRoleId={selectedRoleId}
                onBlur={() => setIsRoleOpen(false)}
                onFocus={() => setIsRoleOpen(true)}
                onSearchChange={(search) => {
                    setRoleSearch(search);
                    setIsRoleOpen(true);
                }}
                onSelect={(role) => {
                    setSelectedRoleId(role.id);
                    setRoleSearch(formatRoleLabel(role));
                    setIsRoleOpen(false);
                }}
            />
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
                onClick={() => void saveFlow()}
                disabled={
                    isSaving || !selectedChannelId || !messageId.trim() || !emojiKey.trim() || !selectedRoleId.trim()
                }
                className='min-h-10 w-full rounded-md bg-sky-400 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                Save verification flow
            </button>
            {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
        </section>
    );
}

function RolePicker({
    roles,
    matchedRoles,
    isOpen,
    search,
    selectedRoleId,
    onBlur,
    onFocus,
    onSearchChange,
    onSelect,
}: {
    roles: DashboardVerificationRole[];
    matchedRoles: DashboardVerificationRole[];
    isOpen: boolean;
    search: string;
    selectedRoleId: string;
    onBlur: () => void;
    onFocus: () => void;
    onSearchChange: (search: string) => void;
    onSelect: (role: DashboardVerificationRole) => void;
}) {
    return (
        <div className='space-y-2 text-sm font-medium text-neutral-200'>
            <label className='space-y-2'>
                <span>Verified role</span>
                <input
                    value={search}
                    onBlur={onBlur}
                    onChange={(event) => onSearchChange(event.currentTarget.value)}
                    onFocus={onFocus}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    autoComplete='off'
                    role='combobox'
                    aria-autocomplete='list'
                    aria-controls='verification-role-options'
                    aria-expanded={isOpen}
                    placeholder='Search roles'
                    disabled={roles.length === 0}
                />
            </label>
            {isOpen && roles.length > 0 ? (
                <ul
                    id='verification-role-options'
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
                                    <span className='min-w-0 truncate'>{role.name}</span>
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

function VerificationFlowList({
    guildId,
    flows,
    onChanged,
}: {
    guildId: string;
    flows: DashboardVerificationFlow[];
    onChanged: () => Promise<void>;
}) {
    const [busyMessageId, setBusyMessageId] = useState<string | undefined>();

    async function deleteFlow(messageId: string): Promise<void> {
        setBusyMessageId(messageId);

        try {
            await deleteDashboardVerificationFlowRouteData({
                data: {
                    guildId,
                    messageId,
                },
            });
            await onChanged();
        } finally {
            setBusyMessageId(undefined);
        }
    }

    return (
        <section className='p-4' aria-labelledby='verification-flow-list-heading'>
            <h4 id='verification-flow-list-heading' className='text-sm font-semibold text-white'>
                Current flows
            </h4>
            {flows.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No verification flows are configured yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[42rem] text-left text-sm'>
                        <thead className='border-b border-neutral-800 text-xs text-neutral-500 uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Message</th>
                                <th className='px-3 py-2 font-semibold'>Emoji</th>
                                <th className='px-3 py-2 font-semibold'>Role</th>
                                <th className='px-3 py-2 font-semibold'>Status</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-neutral-800'>
                            {flows.map((flow) => (
                                <tr key={flow.messageId}>
                                    <td className='py-3 pr-3 align-top'>
                                        <p className='font-medium text-neutral-100'>
                                            #{flow.channelName ?? flow.channelId}
                                        </p>
                                        <p className='mt-1 font-mono text-xs text-neutral-500'>{flow.messageId}</p>
                                    </td>
                                    <td className='px-3 py-3 align-top font-mono text-neutral-300'>{flow.emojiKey}</td>
                                    <td className='px-3 py-3 align-top'>
                                        <p className='font-medium text-neutral-100'>
                                            {flow.verifiedRoleName ?? flow.verifiedRoleId}
                                        </p>
                                        <p className='mt-1 font-mono text-xs text-neutral-500'>{flow.verifiedRoleId}</p>
                                    </td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        {flow.enabled ? 'Enabled' : 'Disabled'}
                                    </td>
                                    <td className='py-3 pl-3 text-right align-top'>
                                        <button
                                            type='button'
                                            onClick={() => void deleteFlow(flow.messageId)}
                                            disabled={busyMessageId === flow.messageId}
                                            className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                            Remove
                                        </button>
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

export function DashboardVerificationLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-36 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 space-y-3'>
                <div className='h-4 w-64 animate-pulse rounded bg-neutral-800' />
                <div className='h-10 w-full animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
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
                placeholder={placeholder}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
            />
        </label>
    );
}

function formatRoleLabel(role: DashboardVerificationRole): string {
    return `@${role.name}`;
}

function matchRoles(roles: DashboardVerificationRole[], query: string): DashboardVerificationRole[] {
    const normalizedQuery = normalizeRoleSearchText(query);

    if (!normalizedQuery) {
        return roles;
    }

    return roles
        .map((role, index) => ({
            role,
            index,
            score: scoreRoleMatch(role, normalizedQuery),
        }))
        .filter((match): match is { role: DashboardVerificationRole; index: number; score: number } => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((match) => match.role);
}

function scoreRoleMatch(role: DashboardVerificationRole, query: string): number {
    const tokens = query.split(/\s+/).filter(Boolean);
    const searchableValues = [role.name, role.id, formatRoleLabel(role)].map(normalizeRoleSearchText);
    let score = 0;

    for (const token of tokens) {
        const tokenScore = Math.max(...searchableValues.map((value) => scoreRoleToken(token, value)));

        if (tokenScore === 0) {
            return 0;
        }

        score += tokenScore;
    }

    return score;
}

function scoreRoleToken(token: string, value: string): number {
    if (!value) return 0;
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

function normalizeRoleSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/[^a-z0-9]+/g, ' ');
}

function toVerificationMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Choose a channel, message, emoji, and role before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'not-found':
            return 'This server is no longer available.';
        default:
            return 'Could not save verification settings.';
    }
}
