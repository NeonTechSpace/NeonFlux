import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getDashboardXpSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardXpSettingsRouteData,
    updateDashboardXpSettingsRouteData,
} from '../server/dashboard-xp-route-data.js';
import type { DashboardXpSettings } from '../server/dashboard-xp.server.js';

type XpSettingsDraft = {
    enabled: boolean;
    messageXpMin: string;
    messageXpMax: string;
    cooldownSeconds: string;
    voiceXpPerMinute: string;
    voiceMinimumMinutes: string;
};

const defaultDraft: XpSettingsDraft = {
    enabled: false,
    messageXpMin: '5',
    messageXpMax: '10',
    cooldownSeconds: '60',
    voiceXpPerMinute: '2',
    voiceMinimumMinutes: '5',
};

export function DashboardXpSettingsPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const [draftOverride, setDraftOverride] = useState<XpSettingsDraft | undefined>();
    const [status, setStatus] = useState<string | undefined>();
    const [isSaving, setIsSaving] = useState(false);
    const queryKey = getDashboardXpSettingsQueryKey(guildId);
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardXpSettingsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'settings') {
                throw new Error('Could not load XP settings.');
            }

            return result.settings;
        },
    });
    const baseDraft = settingsQuery.data ? toDraft(settingsQuery.data) : defaultDraft;
    const draft = draftOverride ?? baseDraft;

    function setDraft(draftUpdate: XpSettingsDraft): void {
        setDraftOverride(draftUpdate);
    }

    async function saveSettings(): Promise<void> {
        const parsed = parseDraft(draft);

        if (!parsed) {
            setStatus('Use whole numbers and keep minimum message XP at or below maximum message XP.');
            return;
        }

        setIsSaving(true);
        setStatus(undefined);

        try {
            const result = await updateDashboardXpSettingsRouteData({
                data: {
                    guildId,
                    ...parsed,
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            queryClient.setQueryData(queryKey, result.settings);
            setDraftOverride(undefined);
            setStatus('Saved.');
            void queryClient.invalidateQueries({
                queryKey,
            });
        } finally {
            setIsSaving(false);
        }
    }

    if (settingsQuery.isPending) {
        return <DashboardXpSettingsLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>XP rules</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load XP settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                    <div>
                        <h3 className='text-lg font-semibold text-white'>XP rules</h3>
                        <p className='mt-1 text-sm leading-6 text-neutral-400'>
                            Award XP from messages and voice activity. Rank and leaderboard commands stay public.
                        </p>
                    </div>
                    <label className='inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100'>
                        <input
                            type='checkbox'
                            checked={draft.enabled}
                            onChange={(event) => setDraft({ ...draft, enabled: event.currentTarget.checked })}
                            className='size-4 accent-sky-400'
                        />
                        Enabled
                    </label>
                </div>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 lg:grid-cols-2 lg:divide-x lg:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='xp-message-heading'>
                    <div>
                        <h4 id='xp-message-heading' className='text-sm font-semibold text-white'>
                            Message XP
                        </h4>
                        <p className='mt-1 text-sm leading-6 text-neutral-400'>
                            Each eligible chat message receives a deterministic value inside this range.
                        </p>
                    </div>
                    <div className='grid gap-3 sm:grid-cols-3'>
                        <NumberField
                            label='Minimum'
                            value={draft.messageXpMin}
                            onChange={(messageXpMin) => setDraft({ ...draft, messageXpMin })}
                        />
                        <NumberField
                            label='Maximum'
                            value={draft.messageXpMax}
                            onChange={(messageXpMax) => setDraft({ ...draft, messageXpMax })}
                        />
                        <NumberField
                            label='Cooldown seconds'
                            value={draft.cooldownSeconds}
                            onChange={(cooldownSeconds) => setDraft({ ...draft, cooldownSeconds })}
                        />
                    </div>
                </section>
                <section className='space-y-4 p-4' aria-labelledby='xp-voice-heading'>
                    <div>
                        <h4 id='xp-voice-heading' className='text-sm font-semibold text-white'>
                            Voice XP
                        </h4>
                        <p className='mt-1 text-sm leading-6 text-neutral-400'>
                            Voice XP is credited when a tracked voice session closes.
                        </p>
                    </div>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <NumberField
                            label='XP per minute'
                            value={draft.voiceXpPerMinute}
                            onChange={(voiceXpPerMinute) => setDraft({ ...draft, voiceXpPerMinute })}
                        />
                        <NumberField
                            label='Minimum minutes'
                            value={draft.voiceMinimumMinutes}
                            onChange={(voiceMinimumMinutes) => setDraft({ ...draft, voiceMinimumMinutes })}
                        />
                    </div>
                </section>
            </div>
            <div className='flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3'>
                <p className='text-sm text-neutral-400'>
                    {settingsQuery.data.updatedAt
                        ? `Last saved ${formatDateTime(settingsQuery.data.updatedAt)}`
                        : 'Not saved yet.'}
                </p>
                <div className='flex items-center gap-3'>
                    {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
                    <button
                        type='button'
                        onClick={() => void saveSettings()}
                        disabled={isSaving}
                        className='min-h-10 rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Save XP rules
                    </button>
                </div>
            </div>
        </article>
    );
}

export function DashboardXpSettingsLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-28 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 grid gap-3 sm:grid-cols-3'>
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
            <span>{label}</span>
            <input
                type='number'
                min='0'
                step='1'
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
            />
        </label>
    );
}

function toDraft(settings: DashboardXpSettings): XpSettingsDraft {
    return {
        enabled: settings.enabled,
        messageXpMin: String(settings.messageXpMin),
        messageXpMax: String(settings.messageXpMax),
        cooldownSeconds: String(settings.cooldownSeconds),
        voiceXpPerMinute: String(settings.voiceXpPerMinute),
        voiceMinimumMinutes: String(settings.voiceMinimumMinutes),
    };
}

function parseDraft(draft: XpSettingsDraft): Omit<DashboardXpSettings, 'updatedAt'> | undefined {
    const messageXpMin = parseWholeNumber(draft.messageXpMin);
    const messageXpMax = parseWholeNumber(draft.messageXpMax);
    const cooldownSeconds = parseWholeNumber(draft.cooldownSeconds);
    const voiceXpPerMinute = parseWholeNumber(draft.voiceXpPerMinute);
    const voiceMinimumMinutes = parseWholeNumber(draft.voiceMinimumMinutes);

    if (
        messageXpMin === undefined ||
        messageXpMax === undefined ||
        cooldownSeconds === undefined ||
        voiceXpPerMinute === undefined ||
        voiceMinimumMinutes === undefined ||
        messageXpMin < 1 ||
        messageXpMax < messageXpMin ||
        cooldownSeconds < 1
    ) {
        return undefined;
    }

    return {
        enabled: draft.enabled,
        messageXpMin,
        messageXpMax,
        cooldownSeconds,
        voiceXpPerMinute,
        voiceMinimumMinutes,
    };
}

function parseWholeNumber(value: string): number | undefined {
    const parsed = Number.parseInt(value, 10);

    return Number.isInteger(parsed) && String(parsed) === value.trim() && parsed >= 0 ? parsed : undefined;
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Check the XP values before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'not-found':
            return 'This server is no longer available.';
        default:
            return 'Could not save XP settings.';
    }
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
