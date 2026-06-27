import { useState } from 'react';

import { submitPublicProfileBuilderFormRouteData } from '../server/profile-builder-route-data.js';
import type { PublicProfileBuilderPageResult } from '../server/profile-builder.server.js';

export function ProfileBuilderPage({ data }: { data: PublicProfileBuilderPageResult }) {
    if (data.type !== 'form') {
        return (
            <main className='min-h-screen bg-black px-6 py-16 text-white'>
                <section className='mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl flex-col justify-center gap-3'>
                    <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>Profile builder</p>
                    <h1 className='text-4xl font-semibold tracking-normal text-white'>Form unavailable</h1>
                    <p className='text-base leading-7 text-neutral-400'>
                        This profile form is not enabled or could not be found.
                    </p>
                </section>
            </main>
        );
    }

    return <ProfileBuilderForm data={data} />;
}

function ProfileBuilderForm({ data }: { data: Extract<PublicProfileBuilderPageResult, { type: 'form' }> }) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [status, setStatus] = useState<string | undefined>();
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function submitForm(): Promise<void> {
        setStatus(undefined);
        setIsSubmitting(true);

        try {
            const result = await submitPublicProfileBuilderFormRouteData({
                data: {
                    guildId: data.guildId,
                    formName: data.formName,
                    values,
                },
            });

            if (result.type !== 'submitted') {
                setStatus(toSubmitStatus(result.type));
                return;
            }

            setValues({});
            setStatus(result.status === 'pending' ? 'Submitted for review.' : 'Submitted.');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <main className='min-h-screen bg-black px-6 py-12 text-white'>
            <section className='mx-auto max-w-2xl'>
                <div className='border-b border-neutral-800 pb-6'>
                    <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>NeonFlux profile</p>
                    <h1 className='mt-3 text-4xl font-semibold tracking-normal text-white'>Profile form</h1>
                    <p className='mt-3 text-base leading-7 text-neutral-400'>Submit profile details for this server.</p>
                </div>
                {data.fields.length === 0 ? (
                    <p className='mt-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300'>
                        This form has no fields configured yet.
                    </p>
                ) : (
                    <form
                        className='mt-6 space-y-4'
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submitForm();
                        }}>
                        {data.fields.map((field) => (
                            <label
                                key={field.fieldKey}
                                className='block space-y-2 text-sm font-medium text-neutral-200'>
                                <span>
                                    {field.label}
                                    {field.required ? <span className='text-sky-300'> *</span> : null}
                                </span>
                                {field.fieldType === 'textarea' ? (
                                    <textarea
                                        rows={5}
                                        maxLength={field.maxLength}
                                        required={field.required}
                                        value={values[field.fieldKey] ?? ''}
                                        onChange={(event) =>
                                            setValues({ ...values, [field.fieldKey]: event.currentTarget.value })
                                        }
                                        className='w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                                    />
                                ) : (
                                    <input
                                        type={field.fieldType === 'url' ? 'url' : 'text'}
                                        maxLength={field.maxLength}
                                        required={field.required}
                                        value={values[field.fieldKey] ?? ''}
                                        onChange={(event) =>
                                            setValues({ ...values, [field.fieldKey]: event.currentTarget.value })
                                        }
                                        className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                                    />
                                )}
                            </label>
                        ))}
                        <div className='flex flex-wrap items-center gap-3 pt-2'>
                            <button
                                type='submit'
                                disabled={isSubmitting}
                                className='min-h-10 rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                                Submit profile
                            </button>
                            <a
                                href='/auth/fluxer/login'
                                className='inline-flex min-h-10 items-center rounded-md border border-neutral-700 px-4 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                                Sign in
                            </a>
                        </div>
                        {status ? <p className='text-sm text-neutral-400'>{status}</p> : null}
                    </form>
                )}
            </section>
        </main>
    );
}

function toSubmitStatus(type: string): string {
    switch (type) {
        case 'auth-required':
            return 'Sign in with Fluxer before submitting.';
        case 'not-member':
            return 'This form is only for members of the server.';
        case 'invalid-input':
            return 'Check the form fields before submitting.';
        case 'not-found':
            return 'This profile form is no longer available.';
        default:
            return 'Could not submit the profile form.';
    }
}
