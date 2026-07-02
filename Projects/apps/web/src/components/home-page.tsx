import { Link } from '@tanstack/react-router';
import { BookOpenText, LayoutDashboard } from 'lucide-react';

export function HomePage() {
    return (
        <main className='flex min-h-screen items-center justify-center bg-black px-6 py-12 text-white'>
            <section className='mx-auto flex w-full max-w-3xl flex-col items-center text-center'>
                <h1 className='text-5xl font-semibold tracking-normal text-white sm:text-7xl'>NeonFlux</h1>
                <p className='mt-5 max-w-xl text-base leading-7 text-neutral-400 sm:text-lg'>
                    A multi functional bot for Fluxer.
                </p>
                <div className='mt-9 grid w-full max-w-sm grid-cols-1 gap-3 sm:grid-cols-2'>
                    <a
                        href='/dashboard'
                        className='inline-flex h-11 items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-medium text-black transition hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none'>
                        <LayoutDashboard className='size-4' aria-hidden='true' />
                        Dashboard
                    </a>
                    <Link
                        to='/docs/topic'
                        className='inline-flex h-11 items-center justify-center gap-2 rounded-md border border-neutral-800 bg-black px-5 text-sm font-medium text-neutral-100 transition hover:border-neutral-600 hover:bg-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none'>
                        <BookOpenText className='size-4' aria-hidden='true' />
                        Docs
                    </Link>
                </div>
            </section>
        </main>
    );
}
