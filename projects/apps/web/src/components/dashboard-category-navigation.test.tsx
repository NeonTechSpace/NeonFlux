// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardCategoryNavigation } from './dashboard-category-navigation.js';

vi.mock('@tanstack/react-router', async () => {
    const { createElement } = await import('react');

    return {
        useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
            select({ pathname: '/dashboard/guild-1' }),
        Link: ({
            to,
            params,
            activeOptions: _activeOptions,
            children,
            ...props
        }: {
            to: string;
            params: { guildId: string };
            activeOptions?: unknown;
            children: ReactNode;
        }) => createElement('a', { ...props, href: to.replace('$guildId', params.guildId) }, children),
    };
});

describe('DashboardCategoryNavigation mobile dialog', () => {
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
        render(
            <DashboardCategoryNavigation
                guild={{ id: 'guild-1', name: 'Alpha Guild' }}
                guilds={[{ id: 'guild-1', name: 'Alpha Guild' }]}
                guildId='guild-1'
                activeCategoryId='overview'
                mode='single'
            />
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
});
