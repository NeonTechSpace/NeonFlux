import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/auth/signed-out')({
    validateSearch: (search: Record<string, unknown>) => ({
        revocation: search.revocation === 'unconfirmed' ? ('unconfirmed' as const) : undefined,
    }),
    component: SignedOutPage,
});

function SignedOutPage() {
    const { revocation } = Route.useSearch();
    const revocationUnconfirmed = revocation === 'unconfirmed';

    return (
        <main className='min-h-screen bg-black px-6 py-16 text-white'>
            <section className='mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl flex-col justify-center gap-5'>
                <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>Session ended</p>
                <div className='space-y-3'>
                    <h1 className='text-4xl font-semibold tracking-normal text-white'>You’re signed out.</h1>
                    <p
                        className='text-base leading-7 text-neutral-400'
                        role={revocationUnconfirmed ? 'alert' : undefined}>
                        {revocationUnconfirmed
                            ? 'This browser’s session was cleared, but server-side revocation could not be confirmed. The session remains bounded by its expiry.'
                            : 'Your browser session was cleared and its server-side session is no longer active.'}
                    </p>
                </div>
                <div className='flex flex-wrap gap-3'>
                    <a
                        href='/'
                        className='inline-flex min-h-10 items-center rounded-md border border-neutral-700 px-4 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-black focus:outline-none'>
                        Return home
                    </a>
                    <a
                        href='/auth/fluxer/login'
                        className='inline-flex min-h-10 items-center rounded-md px-4 text-sm font-semibold text-neutral-400 transition hover:text-neutral-100 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-black focus:outline-none'>
                        Sign in again
                    </a>
                </div>
            </section>
        </main>
    );
}
