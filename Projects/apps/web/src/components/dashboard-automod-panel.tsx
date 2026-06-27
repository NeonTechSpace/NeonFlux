import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getDashboardAutomodSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardAutomodRuleRouteData,
    readDashboardAutomodSettingsRouteData,
    updateDashboardAutomodRuleRouteData,
} from '../server/dashboard-automod-route-data.js';
import type { DashboardAutomodEvent, DashboardAutomodRule } from '../server/dashboard-automod.server.js';

type AutomodTriggerType = 'blocked_terms' | 'invite_links';
type AutomodActionType = 'record' | 'delete_message' | 'timeout' | 'warn';

const triggerLabels: Record<AutomodTriggerType, string> = {
    blocked_terms: 'Blocked terms',
    invite_links: 'Invite links',
};

const actionLabels: Record<AutomodActionType, string> = {
    record: 'Record only',
    delete_message: 'Delete message',
    timeout: 'Timeout user',
    warn: 'Warn user',
};

export function DashboardAutomodPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardAutomodSettingsQueryKey(guildId);
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardAutomodSettingsRouteData({
                data: { guildId },
            });

            if (result.type !== 'settings') {
                throw new Error('Could not load automod settings.');
            }

            return result;
        },
    });

    async function refresh(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey });
    }

    if (settingsQuery.isPending) {
        return <DashboardAutomodLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Automod</h3>
                <p className='mt-2 text-sm text-rose-300'>Could not load automod settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Automod</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Match blocked terms or invite links, then record, delete, or timeout according to the rule action.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <AutomodRuleEditor guildId={guildId} rules={settingsQuery.data.rules} onChanged={refresh} />
                <div className='grid gap-0 divide-y divide-neutral-800'>
                    <AutomodRuleList guildId={guildId} rules={settingsQuery.data.rules} onChanged={refresh} />
                    <AutomodEventList events={settingsQuery.data.events} />
                </div>
            </div>
        </article>
    );
}

function AutomodRuleEditor({
    guildId,
    rules,
    onChanged,
}: {
    guildId: string;
    rules: DashboardAutomodRule[];
    onChanged: () => Promise<void>;
}) {
    const [editingRuleId, setEditingRuleId] = useState('');
    const editingRule = rules.find((rule) => rule.id === editingRuleId);
    const [name, setName] = useState('');
    const [triggerType, setTriggerType] = useState<AutomodTriggerType>('blocked_terms');
    const [actionType, setActionType] = useState<AutomodActionType>('record');
    const [terms, setTerms] = useState('');
    const [timeoutMinutes, setTimeoutMinutes] = useState('10');
    const [ignoredChannelIds, setIgnoredChannelIds] = useState('');
    const [ignoredRoleIds, setIgnoredRoleIds] = useState('');
    const [ignoredUserIds, setIgnoredUserIds] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [status, setStatus] = useState<string | undefined>();
    const [isSaving, setIsSaving] = useState(false);

    function editRule(rule: DashboardAutomodRule): void {
        setEditingRuleId(rule.id);
        setName(rule.name);
        setTriggerType(rule.triggerType);
        setActionType(rule.actionType);
        setTerms(rule.terms.join('\n'));
        setTimeoutMinutes(String(Math.max(1, Math.round((rule.timeoutDurationSeconds ?? 600) / 60))));
        setIgnoredChannelIds(rule.ignoredChannelIds.join('\n'));
        setIgnoredRoleIds(rule.ignoredRoleIds.join('\n'));
        setIgnoredUserIds(rule.ignoredUserIds.join('\n'));
        setEnabled(rule.enabled);
        setStatus(undefined);
    }

    function resetForm(): void {
        setEditingRuleId('');
        setName('');
        setTriggerType('blocked_terms');
        setActionType('record');
        setTerms('');
        setTimeoutMinutes('10');
        setIgnoredChannelIds('');
        setIgnoredRoleIds('');
        setIgnoredUserIds('');
        setEnabled(true);
    }

    async function saveRule(): Promise<void> {
        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await updateDashboardAutomodRuleRouteData({
                data: {
                    guildId,
                    ...(editingRule ? { ruleId: editingRule.id } : {}),
                    name,
                    triggerType,
                    actionType,
                    enabled,
                    terms: parseTerms(terms),
                    ...(actionType === 'timeout'
                        ? { timeoutDurationSeconds: parseTimeoutDurationSeconds(timeoutMinutes) }
                        : {}),
                    ignoredChannelIds: parseTerms(ignoredChannelIds),
                    ignoredRoleIds: parseTerms(ignoredRoleIds),
                    ignoredUserIds: parseTerms(ignoredUserIds),
                },
            });

            if (result.type !== 'updated') {
                setStatus(result.type === 'invalid-input' ? `Invalid ${result.field}.` : 'Could not save rule.');
                return;
            }

            resetForm();
            setStatus('Saved.');
            await onChanged();
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <section className='p-4' aria-labelledby='automod-editor-heading'>
            <div className='flex items-center justify-between gap-3'>
                <h4 id='automod-editor-heading' className='text-sm font-semibold text-white'>
                    {editingRule ? 'Edit rule' : 'Add rule'}
                </h4>
                {editingRule ? (
                    <button
                        type='button'
                        onClick={resetForm}
                        className='text-sm font-medium text-sky-300 transition hover:text-sky-200'>
                        New rule
                    </button>
                ) : null}
            </div>
            <label className='mt-3 block space-y-2 text-sm font-medium text-neutral-200'>
                <span>Name</span>
                <input
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    placeholder='Spam links'
                />
            </label>
            <label className='mt-3 block space-y-2 text-sm font-medium text-neutral-200'>
                <span>Trigger</span>
                <select
                    value={triggerType}
                    onChange={(event) => setTriggerType(event.currentTarget.value as AutomodTriggerType)}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                    <option value='blocked_terms'>Blocked terms</option>
                    <option value='invite_links'>Invite links</option>
                </select>
            </label>
            {triggerType === 'blocked_terms' ? (
                <label className='mt-3 block space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Terms</span>
                    <textarea
                        value={terms}
                        onChange={(event) => setTerms(event.currentTarget.value)}
                        className='min-h-28 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        placeholder={'one term per line\nor comma-separated'}
                    />
                </label>
            ) : null}
            <label className='mt-3 block space-y-2 text-sm font-medium text-neutral-200'>
                <span>Action</span>
                <select
                    value={actionType}
                    onChange={(event) => setActionType(event.currentTarget.value as AutomodActionType)}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                    <option value='record'>Record only</option>
                    <option value='delete_message'>Delete message</option>
                    <option value='timeout'>Timeout user</option>
                    <option value='warn'>Warn user</option>
                </select>
            </label>
            {actionType === 'timeout' ? (
                <label className='mt-3 block space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Timeout minutes</span>
                    <input
                        type='number'
                        min={1}
                        max={40320}
                        value={timeoutMinutes}
                        onChange={(event) => setTimeoutMinutes(event.currentTarget.value)}
                        className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    />
                </label>
            ) : null}
            <div className='mt-3 grid gap-3'>
                <IdListField label='Ignore channels' value={ignoredChannelIds} onChange={setIgnoredChannelIds} />
                <IdListField label='Ignore roles' value={ignoredRoleIds} onChange={setIgnoredRoleIds} />
                <IdListField label='Ignore users' value={ignoredUserIds} onChange={setIgnoredUserIds} />
            </div>
            <label className='mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-medium text-neutral-200'>
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
                onClick={() => void saveRule()}
                disabled={isSaving}
                className='mt-4 min-h-10 w-full rounded-md bg-sky-400 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                {isSaving ? 'Saving...' : 'Save automod rule'}
            </button>
            {status ? <p className='mt-3 text-sm text-neutral-400'>{status}</p> : null}
            {rules.length > 0 ? (
                <div className='mt-5 space-y-2'>
                    <p className='text-xs font-semibold tracking-wide text-neutral-500 uppercase'>Quick edit</p>
                    {rules.map((rule) => (
                        <button
                            key={rule.id}
                            type='button'
                            onClick={() => editRule(rule)}
                            className='block w-full rounded-md border border-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 transition hover:border-sky-500/60'>
                            {rule.name}
                        </button>
                    ))}
                </div>
            ) : null}
        </section>
    );
}

function AutomodRuleList({
    guildId,
    rules,
    onChanged,
}: {
    guildId: string;
    rules: DashboardAutomodRule[];
    onChanged: () => Promise<void>;
}) {
    const [busyRuleId, setBusyRuleId] = useState<string | undefined>();

    async function deleteRule(ruleId: string): Promise<void> {
        setBusyRuleId(ruleId);

        try {
            await deleteDashboardAutomodRuleRouteData({
                data: {
                    guildId,
                    ruleId,
                },
            });
            await onChanged();
        } finally {
            setBusyRuleId(undefined);
        }
    }

    return (
        <section className='p-4' aria-labelledby='automod-rules-heading'>
            <h4 id='automod-rules-heading' className='text-sm font-semibold text-white'>
                Rules
            </h4>
            {rules.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-500'>No automod rules configured.</p>
            ) : (
                <ul className='mt-3 divide-y divide-neutral-800'>
                    {rules.map((rule) => (
                        <li key={rule.id} className='flex items-start justify-between gap-4 py-3'>
                            <div className='min-w-0'>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <p className='font-medium text-white'>{rule.name}</p>
                                    <span className='rounded-sm bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300'>
                                        {triggerLabels[rule.triggerType]}
                                    </span>
                                    <span className='rounded-sm bg-sky-950 px-2 py-0.5 text-xs text-sky-200'>
                                        {actionLabels[rule.actionType]}
                                    </span>
                                    <span
                                        className={
                                            rule.enabled ? 'text-xs text-emerald-300' : 'text-xs text-neutral-500'
                                        }>
                                        {rule.enabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                </div>
                                <p className='mt-1 text-sm text-neutral-400'>
                                    {rule.triggerType === 'blocked_terms'
                                        ? `${rule.terms.length} blocked terms`
                                        : 'Records Discord invite links'}
                                    {rule.actionType === 'timeout' && rule.timeoutDurationSeconds
                                        ? `, ${String(Math.round(rule.timeoutDurationSeconds / 60))} minute timeout`
                                        : ''}
                                    {getIgnoreCount(rule) > 0 ? `, ${String(getIgnoreCount(rule))} ignored IDs` : ''}
                                </p>
                            </div>
                            <button
                                type='button'
                                onClick={() => void deleteRule(rule.id)}
                                disabled={busyRuleId === rule.id}
                                className='shrink-0 rounded-md border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:border-rose-400 hover:text-rose-200 disabled:opacity-50'>
                                Delete
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function AutomodEventList({ events }: { events: DashboardAutomodEvent[] }) {
    return (
        <section className='p-4' aria-labelledby='automod-events-heading'>
            <h4 id='automod-events-heading' className='text-sm font-semibold text-white'>
                Recent matches
            </h4>
            {events.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-500'>No automod matches recorded yet.</p>
            ) : (
                <ul className='mt-3 divide-y divide-neutral-800'>
                    {events.map((event) => (
                        <li
                            key={event.id}
                            className='grid gap-2 py-3 text-sm text-neutral-300 sm:grid-cols-[10rem_minmax(0,1fr)]'>
                            <time className='text-neutral-500'>{formatTimestamp(event.createdAt)}</time>
                            <div className='min-w-0'>
                                <p className='font-medium text-white'>{triggerLabels[event.triggerType]}</p>
                                <p className='mt-1 text-xs font-semibold text-sky-200'>
                                    {actionLabels[event.actionType]} - {event.status.replaceAll('_', ' ')}
                                </p>
                                <p className='mt-1 break-words text-neutral-400'>
                                    User {event.authorUserId} in channel {event.channelId}, message {event.messageId}
                                </p>
                                <p className='mt-1 text-neutral-500'>{formatEventDetails(event)}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function DashboardAutomodLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-label='Loading automod'>
            <div className='h-6 w-32 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 grid gap-4 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]'>
                <div className='h-64 animate-pulse rounded bg-neutral-800' />
                <div className='h-64 animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function IdListField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
            <span>{label}</span>
            <textarea
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                rows={2}
                className='w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                placeholder='One ID per line or comma-separated'
            />
        </label>
    );
}

function parseTerms(value: string): string[] {
    return [
        ...new Set(
            value
                .split(/[\n,]+/u)
                .map((term) => term.trim())
                .filter(Boolean)
        ),
    ];
}

function parseTimeoutDurationSeconds(value: string): number {
    const minutes = Number.parseInt(value, 10);
    const safeMinutes = Number.isFinite(minutes) ? Math.min(Math.max(minutes, 1), 40_320) : 10;

    return safeMinutes * 60;
}

function formatTimestamp(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(value));
}

function formatEventDetails(event: DashboardAutomodEvent): string {
    if (event.triggerType === 'blocked_terms') {
        return `${event.matchedTermCount} matched terms`;
    }

    return `${event.inviteLinkCount} invite links`;
}

function getIgnoreCount(rule: DashboardAutomodRule): number {
    return rule.ignoredChannelIds.length + rule.ignoredRoleIds.length + rule.ignoredUserIds.length;
}
