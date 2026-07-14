import { useForm } from '@tanstack/react-form';
import { type } from 'arktype';

import type { DashboardStructureBackupSettings as DashboardStructureBackupSettingsRecord } from '../server/dashboard-structure-model.js';
import { formatDate } from './dashboard-structure-panel-format.js';
import { dashboardCompactFieldClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

const backupSettingsSchema = type({
    enabled: 'boolean',
    cadenceWeeks: 'number.integer',
    retentionDays: 'number.integer',
});

export type DashboardStructureBackupSettingsValue = typeof backupSettingsSchema.infer;

export function DashboardStructureBackupSettings({
    settings,
    enabled,
    cadenceWeeks,
    retentionDays,
    busy,
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
    onSave: (value: DashboardStructureBackupSettingsValue) => void;
}) {
    const form = useForm({
        defaultValues: {
            enabled,
            cadenceWeeks,
            retentionDays,
        },
        validators: {
            onSubmit: backupSettingsSchema,
        },
        onSubmit: ({ value }) => onSave(value),
    });

    return (
        <form
            id='server-blueprint-backup-settings'
            onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
            }}>
            <div className='flex flex-wrap items-start justify-between gap-4'>
                <div>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>Automatic backups</p>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        The shortest supported cadence is one week.
                    </p>
                </div>
                <form.Field name='enabled'>
                    {(field) => (
                        <label className='flex items-center gap-2 text-sm font-medium text-[var(--dash-text)]'>
                            <input
                                type='checkbox'
                                checked={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.currentTarget.checked)}
                                className='size-4 rounded border-[var(--dash-border-strong)] bg-[var(--dash-bg)]'
                            />
                            Enabled
                        </label>
                    )}
                </form.Field>
            </div>
            <div className='mt-4 flex flex-wrap items-start gap-5'>
                <form.Field
                    name='cadenceWeeks'
                    validators={{
                        onChange: ({ value }) =>
                            Number.isInteger(value) && value >= 1 ? undefined : 'Cadence must be at least one week.',
                    }}>
                    {(field) => (
                        <label className='block text-xs font-semibold text-[var(--dash-text-muted)]'>
                            Cadence
                            <span className='mt-1 flex items-center gap-2'>
                                <input
                                    type='number'
                                    min={1}
                                    step={1}
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onChange={(event) =>
                                        field.handleChange(Number.parseInt(event.currentTarget.value, 10) || 1)
                                    }
                                    className={numberInputClass}
                                />
                                <span className='text-sm font-normal text-[var(--dash-text-muted)]'>
                                    week{field.state.value === 1 ? '' : 's'}
                                </span>
                            </span>
                            <FieldError errors={field.state.meta.errors} />
                        </label>
                    )}
                </form.Field>
                <form.Field
                    name='retentionDays'
                    validators={{
                        onChange: ({ value }) =>
                            Number.isInteger(value) && value >= 1 && value <= 180
                                ? undefined
                                : 'Retention must be between 1 and 180 days.',
                    }}>
                    {(field) => (
                        <label className='block text-xs font-semibold text-[var(--dash-text-muted)]'>
                            Retention
                            <span className='mt-1 flex items-center gap-2'>
                                <input
                                    type='number'
                                    min={1}
                                    max={180}
                                    step={1}
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onChange={(event) =>
                                        field.handleChange(Number.parseInt(event.currentTarget.value, 10) || 1)
                                    }
                                    className={numberInputClass}
                                />
                                <span className='text-sm font-normal text-[var(--dash-text-muted)]'>days</span>
                            </span>
                            <FieldError errors={field.state.meta.errors} />
                        </label>
                    )}
                </form.Field>
                <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                    {([canSubmit, isSubmitting]) => (
                        <button
                            type='submit'
                            disabled={busy || isSubmitting || !canSubmit}
                            className={`mt-5 ${dashboardSecondaryActionClassName}`}>
                            {busy || isSubmitting ? 'Saving' : 'Save'}
                        </button>
                    )}
                </form.Subscribe>
            </div>
            <p className='mt-4 text-xs leading-5 text-[var(--dash-text-subtle)]'>
                {settings.nextBackupAt
                    ? `Next scheduled backup ${formatDate(settings.nextBackupAt)}.`
                    : 'No scheduled backup is queued.'}{' '}
                Stored versions are removed after the selected retention period.
            </p>
        </form>
    );
}

function FieldError({ errors }: { errors: unknown[] }) {
    const message = errors.find((error): error is string => typeof error === 'string');
    return message ? <span className='mt-1 block font-normal text-[var(--dash-danger)]'>{message}</span> : null;
}

const numberInputClass = `${dashboardCompactFieldClassName} h-10 w-20 px-3`;
