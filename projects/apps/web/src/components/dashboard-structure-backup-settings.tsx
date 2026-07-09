import type { DashboardStructureBackupSettings as DashboardStructureBackupSettingsRecord } from '../server/dashboard-structure.server.js';
import { formatDate } from './dashboard-structure-panel-format.js';

export function DashboardStructureBackupSettings({
    settings,
    enabled,
    cadenceWeeks,
    retentionDays,
    busy,
    onEnabledChange,
    onCadenceWeeksChange,
    onRetentionDaysChange,
    onSave,
}: {
    settings: DashboardStructureBackupSettingsRecord;
    enabled: boolean;
    cadenceWeeks: number;
    retentionDays: number;
    busy: boolean;
    onEnabledChange: (enabled: boolean) => void;
    onCadenceWeeksChange: (weeks: number) => void;
    onRetentionDaysChange: (days: number) => void;
    onSave: () => void;
}) {
    return (
        <div
            id='server-blueprint-backup-settings'
            className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='text-sm font-semibold text-white'>Automatic backups</p>
                    <p className='mt-1 text-xs leading-5 text-neutral-400'>
                        Opt-in scheduled backups. Minimum cadence is 1 week.
                    </p>
                </div>
                <label className='flex items-center gap-2 text-sm font-medium text-neutral-200'>
                    <input
                        type='checkbox'
                        checked={enabled}
                        onChange={(event) => onEnabledChange(event.currentTarget.checked)}
                        className='size-4 rounded border-neutral-600 bg-neutral-950'
                    />
                    Enabled
                </label>
            </div>
            <div className='mt-3 flex flex-wrap items-end gap-3'>
                <label className='block text-xs font-semibold text-neutral-300'>
                    Cadence
                    <span className='mt-1 flex items-center gap-2'>
                        <input
                            type='number'
                            min={1}
                            step={1}
                            value={cadenceWeeks}
                            onChange={(event) =>
                                onCadenceWeeksChange(Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1))
                            }
                            className='h-10 w-20 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        />
                        <span className='text-sm text-neutral-400'>week{cadenceWeeks === 1 ? '' : 's'}</span>
                    </span>
                </label>
                <label className='block text-xs font-semibold text-neutral-300'>
                    Retention
                    <span className='mt-1 flex items-center gap-2'>
                        <input
                            type='number'
                            min={1}
                            max={180}
                            step={1}
                            value={retentionDays}
                            onChange={(event) =>
                                onRetentionDaysChange(
                                    Math.min(180, Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1))
                                )
                            }
                            className='h-10 w-20 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        />
                        <span className='text-sm text-neutral-400'>days</span>
                    </span>
                </label>
                <button
                    type='button'
                    onClick={onSave}
                    disabled={busy}
                    className='min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                    {busy ? 'Saving' : 'Save'}
                </button>
            </div>
            <p className='mt-3 text-xs leading-5 text-neutral-500'>
                {settings.nextBackupAt
                    ? `Next scheduled backup: ${formatDate(settings.nextBackupAt)}.`
                    : 'No scheduled backup is queued.'}{' '}
                Backups are automatically removed after {retentionDays} day{retentionDays === 1 ? '' : 's'}.
            </p>
        </div>
    );
}
