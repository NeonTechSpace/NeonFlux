import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardAutomodSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardAutomodRuleRouteData,
    readDashboardAutomodSettingsRouteData,
    updateDashboardAutomodRuleRouteData,
} from '../server/dashboard-automod-route-data.js';
import type { DashboardAutomodEvent, DashboardAutomodRule } from '../server/dashboard-automod.server.js';
import { DashboardEntitySelector } from './dashboard-entity-selector.js';
import type { DashboardEntityOption } from './dashboard-entity-selector.js';

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
            <article className='dashboard-glass-panel p-5'>
                <h3 className='text-lg font-semibold text-[var(--dash-text)]'>Automod</h3>
                <p className='mt-2 text-sm text-rose-300'>Could not load automod settings.</p>
            </article>
        );
    }

    return (
        <article className='dashboard-glass-panel overflow-hidden'>
            <div className='border-b border-[var(--dash-border)] px-5 py-4'>
                <h3 className='text-xl font-semibold text-[var(--dash-text)]'>Automod</h3>
                <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                    Rules for blocked terms and invite links.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-[var(--dash-border)] xl:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <AutomodRuleEditor
                    channels={settingsQuery.data.channels}
                    guildId={guildId}
                    roles={settingsQuery.data.roles}
                    rules={settingsQuery.data.rules}
                    structureReadStatus={settingsQuery.data.structureReadStatus}
                    onChanged={refresh}
                />
                <div className='grid gap-0 divide-y divide-[var(--dash-border)]'>
                    <AutomodRuleList guildId={guildId} rules={settingsQuery.data.rules} onChanged={refresh} />
                    <AutomodEventList events={settingsQuery.data.events} />
                </div>
            </div>
        </article>
    );
}

function AutomodRuleEditor({
    channels,
    guildId,
    roles,
    rules,
    structureReadStatus,
    onChanged,
}: {
    channels: { id: string; name: string; parentName?: string }[];
    guildId: string;
    roles: { id: string; name: string; color: number }[];
    rules: DashboardAutomodRule[];
    structureReadStatus: string;
    onChanged: () => Promise<void>;
}) {
    const [editingRuleId, setEditingRuleId] = useState('');
    const editingRule = rules.find((rule) => rule.id === editingRuleId);
    const [name, setName] = useState('');
    const [triggerType, setTriggerType] = useState<AutomodTriggerType>('blocked_terms');
    const [actionType, setActionType] = useState<AutomodActionType>('record');
    const [terms, setTerms] = useState('');
    const [timeoutMinutes, setTimeoutMinutes] = useState('10');
    const [ignoredChannelIds, setIgnoredChannelIds] = useState<string[]>([]);
    const [ignoredRoleIds, setIgnoredRoleIds] = useState<string[]>([]);
    const [ignoredUserIds, setIgnoredUserIds] = useState<string[]>([]);
    const [enabled, setEnabled] = useState(true);
    const [status, setStatus] = useState<string | undefined>();
    const [isSaving, setIsSaving] = useState(false);
    const channelOptions = useMemo(
        () =>
            channels.map((channel) => ({
                id: channel.id,
                name: channel.name,
                ...(channel.parentName ? { detail: channel.parentName } : {}),
            })),
        [channels]
    );
    const roleOptions = useMemo(
        () =>
            roles.map((role) => ({
                id: role.id,
                name: role.name,
                color: role.color,
            })),
        [roles]
    );

    function editRule(rule: DashboardAutomodRule): void {
        setEditingRuleId(rule.id);
        setName(rule.name);
        setTriggerType(rule.triggerType);
        setActionType(rule.actionType);
        setTerms(rule.terms.join('\n'));
        setTimeoutMinutes(String(Math.max(1, Math.round((rule.timeoutDurationSeconds ?? 600) / 60))));
        setIgnoredChannelIds(rule.ignoredChannelIds);
        setIgnoredRoleIds(rule.ignoredRoleIds);
        setIgnoredUserIds(rule.ignoredUserIds);
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
        setIgnoredChannelIds([]);
        setIgnoredRoleIds([]);
        setIgnoredUserIds([]);
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
                    ignoredChannelIds,
                    ignoredRoleIds,
                    ignoredUserIds,
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
        <section className='p-5' aria-labelledby='automod-editor-heading'>
            <div className='flex items-center justify-between gap-3'>
                <h4 id='automod-editor-heading' className='text-base font-semibold text-[var(--dash-text)]'>
                    {editingRule ? 'Edit rule' : 'Add rule'}
                </h4>
                {editingRule ? (
                    <button
                        type='button'
                        onClick={resetForm}
                        className='text-sm font-medium text-[var(--dash-primary)] transition hover:text-[var(--dash-text)]'>
                        New rule
                    </button>
                ) : null}
            </div>
            <label className='dashboard-label mt-4 block'>
                <span>Name</span>
                <input
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    className='dashboard-field mt-2'
                    placeholder='Spam links'
                />
            </label>
            <label className='dashboard-label mt-3 block'>
                <span>Trigger</span>
                <select
                    value={triggerType}
                    onChange={(event) => setTriggerType(event.currentTarget.value as AutomodTriggerType)}
                    className='dashboard-field mt-2'>
                    <option value='blocked_terms'>Blocked terms</option>
                    <option value='invite_links'>Invite links</option>
                </select>
            </label>
            {triggerType === 'blocked_terms' ? (
                <label className='dashboard-label mt-3 block'>
                    <span>Terms</span>
                    <textarea
                        value={terms}
                        onChange={(event) => setTerms(event.currentTarget.value)}
                        className='dashboard-field mt-2 min-h-28 py-2 text-sm'
                        placeholder={'one term per line\nor comma-separated'}
                    />
                </label>
            ) : null}
            <label className='dashboard-label mt-3 block'>
                <span>Action</span>
                <select
                    value={actionType}
                    onChange={(event) => setActionType(event.currentTarget.value as AutomodActionType)}
                    className='dashboard-field mt-2'>
                    <option value='record'>Record only</option>
                    <option value='delete_message'>Delete message</option>
                    <option value='timeout'>Timeout user</option>
                    <option value='warn'>Warn user</option>
                </select>
            </label>
            {actionType === 'timeout' ? (
                <label className='dashboard-label mt-3 block'>
                    <span>Timeout minutes</span>
                    <input
                        type='number'
                        min={1}
                        max={40320}
                        value={timeoutMinutes}
                        onChange={(event) => setTimeoutMinutes(event.currentTarget.value)}
                        className='dashboard-field mt-2'
                    />
                </label>
            ) : null}
            <div className='mt-3 grid gap-3'>
                <DashboardEntitySelector
                    kind='channel'
                    label='Ignore channels'
                    options={channelOptions}
                    selectedIds={ignoredChannelIds}
                    unavailableText={
                        structureReadStatus === 'available'
                            ? undefined
                            : toStructureUnavailableText(structureReadStatus)
                    }
                    onSelectedIdsChange={setIgnoredChannelIds}
                />
                <DashboardEntitySelector
                    kind='role'
                    label='Ignore roles'
                    options={roleOptions}
                    selectedIds={ignoredRoleIds}
                    unavailableText={
                        structureReadStatus === 'available'
                            ? undefined
                            : toStructureUnavailableText(structureReadStatus)
                    }
                    onSelectedIdsChange={setIgnoredRoleIds}
                />
                <DashboardEntitySelector
                    kind='user'
                    label='Ignore users'
                    options={getKnownUserOptions(ignoredUserIds)}
                    selectedIds={ignoredUserIds}
                    unavailableText='User search is not available yet.'
                    onSelectedIdsChange={setIgnoredUserIds}
                />
            </div>
            <label className='dashboard-secondary-button mt-4 inline-flex min-h-10 items-center gap-2 px-3 text-sm font-medium'>
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
                className='dashboard-primary-button mt-4 min-h-10 w-full px-3 text-sm'>
                {isSaving ? 'Saving...' : 'Save automod rule'}
            </button>
            {status ? <p className='mt-3 text-sm text-[var(--dash-text-muted)]'>{status}</p> : null}
            {rules.length > 0 ? (
                <div className='mt-5 space-y-2'>
                    <p className='text-xs font-semibold tracking-wide text-[var(--dash-text-subtle)] uppercase'>
                        Quick edit
                    </p>
                    {rules.map((rule) => (
                        <button
                            key={rule.id}
                            type='button'
                            onClick={() => editRule(rule)}
                            className='block w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(5,9,16,0.34)] px-3 py-2 text-left text-sm text-[var(--dash-text)] transition hover:border-[var(--dash-border-interactive)]'>
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
        <section className='p-5' aria-labelledby='automod-rules-heading'>
            <h4 id='automod-rules-heading' className='text-base font-semibold text-[var(--dash-text)]'>
                Rules
            </h4>
            {rules.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-[var(--dash-text-muted)]'>No automod rules configured.</p>
            ) : (
                <ul className='mt-3 divide-y divide-[var(--dash-border)]'>
                    {rules.map((rule) => (
                        <li key={rule.id} className='flex items-start justify-between gap-4 py-3'>
                            <div className='min-w-0'>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <p className='font-medium text-[var(--dash-text)]'>{rule.name}</p>
                                    <span className='rounded-sm bg-[var(--dash-surface-raised)] px-2 py-0.5 text-xs text-[var(--dash-text-muted)]'>
                                        {triggerLabels[rule.triggerType]}
                                    </span>
                                    <span className='rounded-sm bg-[var(--dash-primary-soft)] px-2 py-0.5 text-xs text-[var(--dash-primary)]'>
                                        {actionLabels[rule.actionType]}
                                    </span>
                                    <span
                                        className={
                                            rule.enabled
                                                ? 'text-xs text-[var(--dash-primary)]'
                                                : 'text-xs text-[var(--dash-text-muted)]'
                                        }>
                                        {rule.enabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                </div>
                                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                                    {rule.triggerType === 'blocked_terms'
                                        ? `${rule.terms.length} blocked terms`
                                        : 'Records Discord invite links'}
                                    {rule.actionType === 'timeout' && rule.timeoutDurationSeconds
                                        ? `, ${String(Math.round(rule.timeoutDurationSeconds / 60))} minute timeout`
                                        : ''}
                                    {getIgnoreCount(rule) > 0
                                        ? `, ${String(getIgnoreCount(rule))} ignored targets`
                                        : ''}
                                </p>
                            </div>
                            <button
                                type='button'
                                onClick={() => void deleteRule(rule.id)}
                                disabled={busyRuleId === rule.id}
                                className='dashboard-danger-button shrink-0 px-3 py-2 text-sm disabled:opacity-50'>
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
        <section className='p-5' aria-labelledby='automod-events-heading'>
            <h4 id='automod-events-heading' className='text-base font-semibold text-[var(--dash-text)]'>
                Recent matches
            </h4>
            {events.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-[var(--dash-text-muted)]'>No automod matches recorded yet.</p>
            ) : (
                <ul className='mt-3 divide-y divide-[var(--dash-border)]'>
                    {events.map((event) => (
                        <li
                            key={event.id}
                            className='grid gap-2 py-3 text-sm text-[var(--dash-text-muted)] sm:grid-cols-[10rem_minmax(0,1fr)]'>
                            <time className='text-[var(--dash-text-subtle)]'>{formatTimestamp(event.createdAt)}</time>
                            <div className='min-w-0'>
                                <p className='font-medium text-[var(--dash-text)]'>
                                    {triggerLabels[event.triggerType]}
                                </p>
                                <p className='mt-1 text-xs font-semibold text-[var(--dash-primary)]'>
                                    {actionLabels[event.actionType]} - {event.status.replaceAll('_', ' ')}
                                </p>
                                <p className='mt-1 break-words text-[var(--dash-text-muted)]'>
                                    User {event.authorUserId} in channel {event.channelId}, message {event.messageId}
                                </p>
                                <p className='mt-1 text-[var(--dash-text-subtle)]'>{formatEventDetails(event)}</p>
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
        <article className='dashboard-glass-panel p-5' aria-label='Loading automod'>
            <div className='h-6 w-32 animate-pulse rounded bg-[var(--dash-primary-soft)]' />
            <div className='mt-4 grid gap-4 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]'>
                <div className='h-64 animate-pulse rounded-[var(--dash-radius-panel)] bg-[var(--dash-surface-raised)]' />
                <div className='h-64 animate-pulse rounded-[var(--dash-radius-panel)] bg-[var(--dash-surface-raised)]' />
            </div>
        </article>
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

function toStructureUnavailableText(status: string): string {
    return status === 'bot-token-missing'
        ? 'Set FLUXER_BOT_TOKEN to load server targets.'
        : 'Could not load server targets.';
}

function getKnownUserOptions(userIds: string[]): DashboardEntityOption[] {
    return userIds.map((userId) => ({
        id: userId,
        name: userId,
    }));
}
