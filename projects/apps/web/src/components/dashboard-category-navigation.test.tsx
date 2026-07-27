// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardNavigationEntry } from '../dashboard-categories.js';
import { DashboardCategoryNavigation } from './dashboard-category-navigation.js';

const renderedNavigations: RenderResult[] = [];

vi.mock('@tanstack/react-router', async () => {
    const { createElement } = await import('react');

    return {
        useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
            select({ pathname: '/dashboard/guild-1' }),
        Link: ({
            to,
            params,
            activeOptions: _activeOptions,
            state: _state,
            preload: _preload,
            children,
            ...props
        }: {
            to: string;
            params?: { guildId: string };
            activeOptions?: unknown;
            state?: unknown;
            preload?: unknown;
            children: ReactNode;
        }) => createElement('a', { ...props, href: params ? to.replace('$guildId', params.guildId) : to }, children),
    };
});

vi.mock('../dashboard-categories.js', async () => {
    const actual = await vi.importActual('../dashboard-categories.js');
    const entries = (actual as { dashboardNavigationEntries: readonly DashboardNavigationEntry[] })
        .dashboardNavigationEntries;

    return {
        ...actual,
        dashboardNavigationEntries: entries.map((entry) => {
            if (entry.category.id !== 'create-deliver') {
                return entry;
            }

            const firstItem = entry.subNavigation.at(0);

            if (!firstItem) {
                return entry;
            }

            return {
                ...entry,
                type: 'group',
                defaultSubNavigationTo: firstItem.to,
                subNavigation: [
                    firstItem,
                    {
                        ...firstItem,
                        id: 'scheduled-messages',
                        label: 'Scheduled Messages',
                    },
                ],
            };
        }),
    };
});

describe('DashboardCategoryNavigation mobile dialog', () => {
    afterEach(() => {
        for (const renderedNavigation of renderedNavigations.splice(0)) {
            renderedNavigation.unmount();
        }
    });

    beforeEach(() => {
        Object.defineProperties(HTMLDialogElement.prototype, {
            showModal: {
                configurable: true,
                value(this: HTMLDialogElement) {
                    this.setAttribute('open', '');
                },
            },
            close: {
                configurable: true,
                value(this: HTMLDialogElement) {
                    this.removeAttribute('open');
                },
            },
        });
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({
                matches: false,
                media: '(min-width: 768px)',
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }),
        });
    });

    it('moves focus into the modal sheet and restores it after Escape', async () => {
        renderedNavigations.push(
            render(
                <DashboardCategoryNavigation
                    guild={{ id: 'guild-1', name: 'Alpha Guild' }}
                    guilds={[{ id: 'guild-1', name: 'Alpha Guild' }]}
                    guildId='guild-1'
                    activeCategoryId='overview'
                    mode='single'
                />
            )
        );

        const trigger = screen.getByRole('button', { name: 'Open dashboard menu' });
        fireEvent.click(trigger);

        const dialog = await screen.findByRole('dialog', { name: 'Dashboard menu' });
        const closeButtons = screen.getAllByRole('button', { name: 'Close dashboard menu' });
        await waitFor(() => expect(closeButtons.some((button) => button.matches(':focus'))).toBe(true));

        fireEvent(dialog, new Event('cancel', { cancelable: true }));

        await waitFor(() => expect(trigger.matches(':focus')).toBe(true));
        expect(screen.queryByRole('dialog', { name: 'Dashboard menu' })).toBeNull();
    });

    it('makes a one-server multi-instance switcher directly available from the mobile header', () => {
        renderedNavigations.push(
            render(
                <DashboardCategoryNavigation
                    guild={{ id: 'guild-1', name: 'Alpha Guild' }}
                    guilds={[{ id: 'guild-1', name: 'Alpha Guild' }]}
                    guildId='guild-1'
                    activeCategoryId='overview'
                    mode='multi'
                />
            )
        );

        const mobileHeader = screen.getByRole('banner');
        const serverTrigger = within(mobileHeader).getByRole('button', {
            name: 'Switch server, currently Alpha Guild',
        });
        const navigationTrigger = within(mobileHeader).getByRole('button', { name: 'Open dashboard menu' });

        fireEvent.click(serverTrigger);

        expect(screen.getByRole('dialog', { name: 'Switch server' })).toBeDefined();
        expect(serverTrigger.getAttribute('aria-expanded')).toBe('true');
        expect(navigationTrigger.getAttribute('aria-expanded')).toBe('false');
        expect(screen.getByRole('link', { name: 'All servers' })).toBeDefined();
    });

    it('opens future rail groups through a portaled, focus-owned disclosure', async () => {
        const view = render(
            <div className='dashboard-theme' data-testid='dashboard-theme'>
                <DashboardCategoryNavigation
                    guild={{ id: 'guild-1', name: 'Alpha Guild' }}
                    guilds={[{ id: 'guild-1', name: 'Alpha Guild' }]}
                    guildId='guild-1'
                    activeCategoryId='overview'
                    mode='single'
                />
            </div>
        );
        renderedNavigations.push(view);

        const railTrigger = screen.getByRole('button', { name: 'Open Create & Deliver destinations' });
        fireEvent.click(railTrigger);

        const disclosure = await screen.findByRole('dialog', { name: 'Create & Deliver' });
        const theme = screen.getByTestId('dashboard-theme');
        expect(within(theme).getByRole('dialog', { name: 'Create & Deliver' })).toBe(disclosure);

        const links = within(disclosure).getAllByRole('link');
        await waitFor(() => expect(links[0]?.matches(':focus')).toBe(true));

        const closeButton = within(disclosure).getByRole('button', {
            name: 'Close Create & Deliver destinations',
        });
        closeButton.focus();
        fireEvent.keyDown(disclosure, { key: 'Tab', shiftKey: true });
        expect(links.at(-1)?.matches(':focus')).toBe(true);

        fireEvent.scroll(disclosure);
        expect(screen.getByRole('dialog', { name: 'Create & Deliver' })).toBe(disclosure);

        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(railTrigger.matches(':focus')).toBe(true));
        expect(screen.queryByRole('dialog', { name: 'Create & Deliver' })).toBeNull();

        fireEvent.click(railTrigger);
        expect(await screen.findByRole('dialog', { name: 'Create & Deliver' })).toBeDefined();
        fireEvent(window, new Event('resize'));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create & Deliver' })).toBeNull());
    });

    it('portals compact appearance controls and restores trigger focus', async () => {
        const view = render(
            <div className='dashboard-theme' data-testid='dashboard-theme'>
                <DashboardCategoryNavigation
                    guild={{ id: 'guild-1', name: 'Alpha Guild' }}
                    guilds={[{ id: 'guild-1', name: 'Alpha Guild' }]}
                    guildId='guild-1'
                    activeCategoryId='overview'
                    mode='single'
                />
            </div>
        );
        renderedNavigations.push(view);

        const trigger = screen.getByRole('button', { name: 'Appearance controls' });
        const signOutForm = screen.getByRole('form', { name: 'Sign out' });

        expect(signOutForm.getAttribute('action')).toBe('/auth/logout');
        fireEvent.click(trigger);

        const dialog = await screen.findByRole('dialog', { name: 'Appearance controls' });
        expect(within(screen.getByTestId('dashboard-theme')).getByRole('dialog', { name: 'Appearance controls' })).toBe(
            dialog
        );
        await waitFor(() =>
            expect(within(dialog).getByRole('button', { name: 'Reduce effects' }).matches(':focus')).toBe(true)
        );

        fireEvent.keyDown(window, { key: 'Escape' });

        await waitFor(() => expect(trigger.matches(':focus')).toBe(true));
        expect(screen.queryByRole('dialog', { name: 'Appearance controls' })).toBeNull();
    });
});
