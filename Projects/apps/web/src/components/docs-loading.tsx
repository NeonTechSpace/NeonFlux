export function DocsRouteLoading() {
    return (
        <main className='min-h-screen bg-neutral-950 text-neutral-100' role='status' aria-label='Loading documentation'>
            <span className='sr-only'>Loading documentation</span>
            <div
                className='fixed inset-0'
                style={{
                    backgroundImage: [
                        'linear-gradient(180deg, rgba(0, 0, 0, 0.68), rgba(0, 0, 0, 0.84) 100%)',
                        'radial-gradient(ellipse at 48% -12%, rgba(56, 189, 248, 0.14), transparent 42%)',
                        'radial-gradient(ellipse at 82% 8%, rgba(217, 70, 239, 0.14), transparent 38%)',
                        'linear-gradient(145deg, rgba(0, 2, 8, 1), rgba(1, 5, 18, 0.98) 46%, rgba(8, 3, 20, 1) 74%, rgba(0, 1, 6, 1))',
                    ].join(','),
                }}
            />
            <div className='relative grid min-h-screen lg:grid-cols-[17rem_1fr]'>
                <aside className='hidden border-r border-neutral-800/80 bg-neutral-950/80 p-5 lg:block'>
                    <div className='h-8 w-28 animate-pulse rounded bg-neutral-900' />
                    <div className='mt-8 h-10 animate-pulse rounded-lg bg-neutral-900' />
                    <div className='mt-8 space-y-3'>
                        <div className='h-4 w-16 animate-pulse rounded bg-neutral-900' />
                        <div className='h-9 animate-pulse rounded-md bg-neutral-900' />
                        <div className='h-9 animate-pulse rounded-md bg-neutral-900/70' />
                    </div>
                    <div className='mt-8 space-y-3'>
                        <div className='h-4 w-24 animate-pulse rounded bg-neutral-900' />
                        <div className='h-9 animate-pulse rounded-md bg-neutral-900/70' />
                        <div className='h-9 animate-pulse rounded-md bg-neutral-900/70' />
                    </div>
                </aside>
                <section className='mx-auto w-full max-w-5xl px-6 py-14 lg:px-12'>
                    <div className='h-4 w-24 animate-pulse rounded bg-sky-500/20' />
                    <div className='mt-6 h-10 w-64 max-w-full animate-pulse rounded bg-neutral-900' />
                    <div className='mt-5 h-5 w-full max-w-lg animate-pulse rounded bg-neutral-900/80' />
                    <div className='mt-12 grid gap-4 sm:grid-cols-2'>
                        <div className='h-28 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900/70' />
                        <div className='h-28 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900/70' />
                    </div>
                    <div className='mt-12 space-y-4'>
                        <div className='h-7 w-48 animate-pulse rounded bg-neutral-900' />
                        <div className='h-4 w-full max-w-3xl animate-pulse rounded bg-neutral-900/80' />
                        <div className='h-4 w-11/12 max-w-3xl animate-pulse rounded bg-neutral-900/80' />
                        <div className='h-4 w-2/3 max-w-2xl animate-pulse rounded bg-neutral-900/80' />
                    </div>
                </section>
            </div>
        </main>
    );
}
