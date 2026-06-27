import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getDashboardProfileBuilderSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardProfileBuilderSettingsRouteData,
    reviewDashboardProfileSubmissionRouteData,
    updateDashboardProfileBuilderFormRouteData,
} from '../server/dashboard-profile-builder-route-data.js';
import type { DashboardProfileForm, DashboardProfileSubmission } from '../server/dashboard-profile-builder.server.js';
import type { DashboardProfileField, DashboardProfileFieldType } from '../server/profile-builder-shared.js';

type ProfileBuilderDraft = {
    name: string;
    approvalRequired: boolean;
    enabled: boolean;
    fields: DashboardProfileField[];
};

const defaultDraft: ProfileBuilderDraft = {
    name: 'default',
    approvalRequired: true,
    enabled: true,
    fields: [
        {
            fieldKey: 'display_name',
            label: 'Display name',
            fieldType: 'text',
            required: true,
            maxLength: 80,
            position: 0,
        },
        {
            fieldKey: 'bio',
            label: 'Bio',
            fieldType: 'textarea',
            required: false,
            maxLength: 500,
            position: 1,
        },
    ],
};

export function DashboardProfileBuilderPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const queryKey = getDashboardProfileBuilderSettingsQueryKey(guildId);
    const [draft, setDraft] = useState<ProfileBuilderDraft>(defaultDraft);
    const [status, setStatus] = useState<string | undefined>();
    const [busyAction, setBusyAction] = useState<string | undefined>();
    const settingsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            const result = await readDashboardProfileBuilderSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') {
                throw new Error('Could not load profile builder settings.');
            }

            return result;
        },
    });
    const selectedForm = useMemo(
        () => settingsQuery.data?.forms.find((form) => form.name === draft.name),
        [draft.name, settingsQuery.data?.forms]
    );

    async function refreshSettings(): Promise<void> {
        await queryClient.invalidateQueries({ queryKey });
    }

    async function saveForm(): Promise<void> {
        setStatus(undefined);
        setBusyAction('save');

        try {
            const result = await updateDashboardProfileBuilderFormRouteData({
                data: {
                    guildId,
                    name: draft.name,
                    approvalRequired: draft.approvalRequired,
                    enabled: draft.enabled,
                    fields: draft.fields.map(({ fieldKey, label, fieldType, required, maxLength }) => ({
                        fieldKey,
                        label,
                        fieldType,
                        required,
                        maxLength: maxLength ?? null,
                    })),
                },
            });

            if (result.type !== 'updated') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setDraft(toDraft(result.form));
            setStatus('Saved.');
            await refreshSettings();
        } finally {
            setBusyAction(undefined);
        }
    }

    async function reviewSubmission(submission: DashboardProfileSubmission, decision: 'approved' | 'rejected') {
        setStatus(undefined);
        setBusyAction(`${decision}:${submission.id}`);

        try {
            const result = await reviewDashboardProfileSubmissionRouteData({
                data: {
                    guildId,
                    submissionId: submission.id,
                    decision,
                },
            });

            if (result.type !== 'reviewed') {
                setStatus(toMutationStatus(result.type));
                return;
            }

            setStatus(decision === 'approved' ? 'Approved.' : 'Rejected.');
            await refreshSettings();
        } finally {
            setBusyAction(undefined);
        }
    }

    if (settingsQuery.isPending) {
        return <DashboardProfileBuilderLoading />;
    }

    if (settingsQuery.isError) {
        return (
            <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
                <h3 className='text-lg font-semibold text-white'>Profile builder</h3>
                <p className='mt-2 text-sm leading-6 text-rose-300'>Could not load profile builder settings.</p>
            </article>
        );
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Profile builder</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Collect member profile submissions through a public form and review them here.
                </p>
            </div>
            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(20rem,30rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='profile-builder-editor-heading'>
                    <h4 id='profile-builder-editor-heading' className='text-sm font-semibold text-white'>
                        Form editor
                    </h4>
                    <PublicUrlStatus status={settingsQuery.data.publicUrlStatus} form={selectedForm} />
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Form handle</span>
                        <input
                            value={draft.name}
                            onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                            className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 font-mono text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='default'
                        />
                    </label>
                    <div className='flex flex-wrap gap-2'>
                        <Toggle
                            label='Approval required'
                            checked={draft.approvalRequired}
                            onChange={(approvalRequired) => setDraft({ ...draft, approvalRequired })}
                        />
                        <Toggle
                            label='Enabled'
                            checked={draft.enabled}
                            onChange={(enabled) => setDraft({ ...draft, enabled })}
                        />
                    </div>
                    <FieldEditor fields={draft.fields} onChange={(fields) => setDraft({ ...draft, fields })} />
                    <button
                        type='button'
                        onClick={() => void saveForm()}
                        disabled={Boolean(busyAction)}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        Save profile form
                    </button>
                    {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
                </section>
                <section className='space-y-6 p-4'>
                    <FormList forms={settingsQuery.data.forms} onEdit={(form) => setDraft(toDraft(form))} />
                    <SubmissionList
                        submissions={settingsQuery.data.submissions}
                        busyAction={busyAction}
                        onReview={(submission, decision) => void reviewSubmission(submission, decision)}
                    />
                </section>
            </div>
        </article>
    );
}

function FieldEditor({
    fields,
    onChange,
}: {
    fields: DashboardProfileField[];
    onChange: (fields: DashboardProfileField[]) => void;
}) {
    function updateField(index: number, patch: Partial<DashboardProfileField>): void {
        onChange(fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)));
    }

    return (
        <div className='space-y-3'>
            <div className='flex items-center justify-between gap-3'>
                <h5 className='text-sm font-semibold text-white'>Fields</h5>
                <button
                    type='button'
                    onClick={() =>
                        onChange([
                            ...fields,
                            {
                                fieldKey: `field_${fields.length + 1}`,
                                label: 'New field',
                                fieldType: 'text',
                                required: false,
                                position: fields.length,
                            },
                        ])
                    }
                    className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                    Add field
                </button>
            </div>
            {fields.map((field, index) => (
                <div key={field.id ?? field.fieldKey} className='rounded-md border border-neutral-800 p-3'>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <TextInput
                            label='Label'
                            value={field.label}
                            onChange={(label) => updateField(index, { label })}
                        />
                        <TextInput
                            label='Key'
                            value={field.fieldKey}
                            onChange={(fieldKey) => updateField(index, { fieldKey })}
                        />
                        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                            <span>Type</span>
                            <select
                                value={field.fieldType}
                                onChange={(event) =>
                                    updateField(index, {
                                        fieldType: event.currentTarget.value as DashboardProfileFieldType,
                                    })
                                }
                                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                                <option value='text'>Text</option>
                                <option value='textarea'>Long text</option>
                                <option value='url'>URL</option>
                            </select>
                        </label>
                        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                            <span>Max length</span>
                            <input
                                type='number'
                                min={1}
                                max={1000}
                                value={field.maxLength ?? ''}
                                onChange={(event) =>
                                    updateField(index, {
                                        maxLength: event.currentTarget.value
                                            ? Number(event.currentTarget.value)
                                            : undefined,
                                    })
                                }
                                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            />
                        </label>
                    </div>
                    <div className='mt-3 flex flex-wrap gap-2'>
                        <Toggle
                            label='Required'
                            checked={field.required}
                            onChange={(required) => updateField(index, { required })}
                        />
                        <button
                            type='button'
                            onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}
                            className='min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-rose-300 hover:text-rose-200'>
                            Remove
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

function FormList({ forms, onEdit }: { forms: DashboardProfileForm[]; onEdit: (form: DashboardProfileForm) => void }) {
    return (
        <div>
            <h4 className='text-sm font-semibold text-white'>Configured forms</h4>
            {forms.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No profile forms are configured yet.</p>
            ) : (
                <div className='mt-3 overflow-x-auto'>
                    <table className='w-full min-w-[38rem] text-left text-sm'>
                        <thead className='border-b border-neutral-800 text-xs text-neutral-500 uppercase'>
                            <tr>
                                <th className='py-2 pr-3 font-semibold'>Form</th>
                                <th className='px-3 py-2 font-semibold'>Fields</th>
                                <th className='px-3 py-2 font-semibold'>Status</th>
                                <th className='py-2 pl-3 text-right font-semibold'>Actions</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-neutral-800'>
                            {forms.map((form) => (
                                <tr key={form.id}>
                                    <td className='py-3 pr-3 align-top font-mono text-neutral-100'>{form.name}</td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>{form.fields.length}</td>
                                    <td className='px-3 py-3 align-top text-neutral-300'>
                                        {form.enabled ? 'Enabled' : 'Disabled'}
                                    </td>
                                    <td className='py-3 pl-3 text-right align-top'>
                                        <button
                                            type='button'
                                            onClick={() => onEdit(form)}
                                            className='min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                                            Edit
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function SubmissionList({
    submissions,
    busyAction,
    onReview,
}: {
    submissions: DashboardProfileSubmission[];
    busyAction: string | undefined;
    onReview: (submission: DashboardProfileSubmission, decision: 'approved' | 'rejected') => void;
}) {
    return (
        <div>
            <h4 className='text-sm font-semibold text-white'>Recent submissions</h4>
            {submissions.length === 0 ? (
                <p className='mt-3 text-sm leading-6 text-neutral-400'>No profile submissions yet.</p>
            ) : (
                <div className='mt-3 space-y-3'>
                    {submissions.map((submission) => (
                        <div key={submission.id} className='rounded-md border border-neutral-800 p-3'>
                            <div className='flex flex-wrap items-start justify-between gap-3'>
                                <div>
                                    <p className='font-semibold text-neutral-100'>
                                        {submission.formName} / {submission.status}
                                    </p>
                                    <p className='mt-1 font-mono text-xs text-neutral-500'>
                                        {submission.userId} • {new Date(submission.submittedAt).toLocaleString()}
                                    </p>
                                </div>
                                {submission.status === 'pending' ? (
                                    <div className='flex gap-2'>
                                        <button
                                            type='button'
                                            onClick={() => onReview(submission, 'approved')}
                                            disabled={busyAction === `approved:${submission.id}`}
                                            className='min-h-9 rounded-md border border-emerald-500/50 px-3 text-sm font-semibold text-emerald-200 transition hover:border-emerald-300 disabled:opacity-50'>
                                            Approve
                                        </button>
                                        <button
                                            type='button'
                                            onClick={() => onReview(submission, 'rejected')}
                                            disabled={busyAction === `rejected:${submission.id}`}
                                            className='min-h-9 rounded-md border border-rose-500/50 px-3 text-sm font-semibold text-rose-200 transition hover:border-rose-300 disabled:opacity-50'>
                                            Reject
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                            <dl className='mt-3 grid gap-2 text-sm sm:grid-cols-2'>
                                {Object.entries(submission.values).map(([key, value]) => (
                                    <div key={key}>
                                        <dt className='font-mono text-xs text-neutral-500'>{key}</dt>
                                        <dd className='mt-1 break-words text-neutral-200'>{String(value)}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function PublicUrlStatus({ status, form }: { status: string; form: DashboardProfileForm | undefined }) {
    if (status !== 'available') {
        return (
            <p className='text-sm leading-6 text-amber-200'>
                Set a public web URL before sharing profile forms outside the dashboard.
            </p>
        );
    }

    if (!form?.publicUrl) {
        return <p className='text-sm leading-6 text-neutral-400'>Save this form to generate its public link.</p>;
    }

    return (
        <p className='text-sm leading-6 break-all text-sky-200'>
            <a href={form.publicUrl} className='underline decoration-sky-400/60 underline-offset-4'>
                {form.publicUrl}
            </a>
        </p>
    );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className='block space-y-2 text-sm font-medium text-neutral-200'>
            <span>{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
            />
        </label>
    );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <label className='inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100'>
            <input
                type='checkbox'
                checked={checked}
                onChange={(event) => onChange(event.currentTarget.checked)}
                className='size-4 accent-sky-400'
            />
            {label}
        </label>
    );
}

export function DashboardProfileBuilderLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='h-5 w-32 animate-pulse rounded bg-neutral-800' />
            <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
                <div className='h-10 animate-pulse rounded bg-neutral-800' />
            </div>
        </article>
    );
}

function toDraft(form: DashboardProfileForm): ProfileBuilderDraft {
    return {
        name: form.name,
        approvalRequired: form.approvalRequired,
        enabled: form.enabled,
        fields: form.fields,
    };
}

function toMutationStatus(type: string): string {
    switch (type) {
        case 'invalid-input':
            return 'Check the form fields before saving.';
        case 'auth-required':
            return 'Sign in again before changing profile settings.';
        case 'not-found':
            return 'This server, form, or submission is no longer available.';
        default:
            return 'Could not save profile builder settings.';
    }
}
