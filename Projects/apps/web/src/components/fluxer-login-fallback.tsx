export function FluxerLoginFallback() {
    return (
        <main className='min-h-screen bg-black px-6 py-16 text-white'>
            <section className='mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl flex-col justify-center gap-5'>
                <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>Fluxer OAuth</p>
                <div className='space-y-3'>
                    <h1 className='text-4xl font-semibold tracking-normal text-white'>Redirecting to Fluxer...</h1>
                    <p className='text-base leading-7 text-neutral-400'>
                        Continue to Fluxer login if the redirect does not start automatically.
                    </p>
                </div>
                <a
                    href='/auth/fluxer/login'
                    className='inline-flex min-h-10 w-fit items-center rounded-md border border-neutral-700 px-4 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-black focus:outline-none'>
                    Continue to Fluxer login
                </a>
            </section>
        </main>
    );
}
