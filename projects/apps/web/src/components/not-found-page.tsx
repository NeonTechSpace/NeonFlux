import { Link } from '@tanstack/react-router';

export function NotFoundPage() {
    return (
        <main className='min-h-screen bg-black px-6 py-16 text-white'>
            <section className='mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl flex-col justify-center gap-6'>
                <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>404</p>
                <div className='space-y-3'>
                    <h1 className='text-4xl font-semibold tracking-normal text-white'>Page not found</h1>
                    <p className='text-base leading-7 text-neutral-400'>
                        This page does not exist or is not available anymore.
                    </p>
                </div>
                <Link
                    to='/'
                    className='inline-flex min-h-10 w-fit items-center rounded-md border border-neutral-700 px-4 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-black focus:outline-none'>
                    Back to home
                </Link>
            </section>
        </main>
    );
}
