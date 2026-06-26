import { Link, useNavigate } from '@tanstack/react-router';

import { dashboardCategories, getDashboardCategory } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';

export function DashboardCategoryNavigation({
    guildId,
    activeCategoryId,
}: {
    guildId: string;
    activeCategoryId: DashboardCategoryId;
}) {
    const activeCategory = getDashboardCategory(activeCategoryId);

    return (
        <div className='space-y-3'>
            <DashboardCategorySelect guildId={guildId} activeCategoryId={activeCategoryId} />
            <nav
                className='hidden rounded-lg border border-neutral-800 bg-neutral-900 p-2 lg:block'
                aria-label='Dashboard categories'>
                <ul className='space-y-1'>
                    {dashboardCategories.map((category) => (
                        <li key={category.id}>
                            <Link
                                to={category.to}
                                params={{ guildId }}
                                aria-current={activeCategoryId === category.id ? 'page' : undefined}
                                className={
                                    activeCategoryId === category.id
                                        ? 'block rounded-md bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100'
                                        : 'block rounded-md px-3 py-2 text-sm font-semibold text-neutral-300 transition hover:bg-neutral-800 hover:text-white focus:bg-neutral-800 focus:outline-none'
                                }>
                                <span>{category.label}</span>
                                {category.status === 'planned' ? (
                                    <span className='ml-2 text-xs font-medium text-neutral-500' aria-hidden='true'>
                                        Soon
                                    </span>
                                ) : null}
                            </Link>
                        </li>
                    ))}
                </ul>
            </nav>
            <div className='rounded-lg border border-neutral-800 bg-neutral-900 p-4 lg:hidden'>
                <h2 className='text-base font-semibold text-white'>{activeCategory.label}</h2>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>{activeCategory.description}</p>
            </div>
        </div>
    );
}

function DashboardCategorySelect({
    guildId,
    activeCategoryId,
}: {
    guildId: string;
    activeCategoryId: DashboardCategoryId;
}) {
    const navigate = useNavigate();

    return (
        <label className='space-y-2 text-sm font-medium text-neutral-200 lg:hidden'>
            <span>Dashboard category</span>
            <select
                value={activeCategoryId}
                onChange={(event) => {
                    const nextCategory = getDashboardCategory(event.currentTarget.value as DashboardCategoryId);

                    void navigate({
                        to: nextCategory.to,
                        params: {
                            guildId,
                        },
                    });
                }}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'>
                {dashboardCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                        {category.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
