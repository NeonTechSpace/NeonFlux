// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DashboardCommandSearch, DashboardCommandSearchTrigger } from './dashboard-command-search.js';

const views: RenderResult[] = [];

describe('DashboardCommandSearch', () => {
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
    });

    afterEach(() => {
        for (const view of views.splice(0)) {
            view.unmount();
        }
    });

    it('opens from Control or Command K and moves focus into search', async () => {
        renderCommandSearch();

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

        const searchInput = await screen.findByRole('searchbox', { name: 'Search dashboard' });
        expect(screen.getByRole('dialog', { name: 'Find a destination' })).toBeTruthy();
        await waitFor(() => expect(searchInput.matches(':focus')).toBe(true));
    });

    it('searches only available routes and preserves the active subroute when switching servers', async () => {
        renderCommandSearch();
        fireEvent.click(screen.getByRole('button', { name: 'Search dashboard' }));

        const searchInput = await screen.findByRole('searchbox', { name: 'Search dashboard' });
        fireEvent.change(searchInput, { target: { value: 'message builder' } });

        expect(screen.getByRole('link', { name: /Create & Deliver/u }).getAttribute('href')).toBe(
            '/dashboard/guild-1/messaging/message-builder'
        );
        expect(screen.queryByText('Bluesky')).toBeNull();

        fireEvent.change(searchInput, { target: { value: 'beta' } });

        expect(screen.getByRole('link', { name: /Beta Guild/u }).getAttribute('href')).toBe(
            '/dashboard/guild-2/access/reaction-roles'
        );
        expect(document.body.textContent).not.toContain('guild-2');
    });

    it('closes with Escape and restores focus to the invoking trigger', async () => {
        renderCommandSearch();
        const trigger = screen.getByRole('button', { name: 'Search dashboard' });
        trigger.focus();
        fireEvent.click(trigger);

        await waitFor(() => expect(screen.getByRole('searchbox').matches(':focus')).toBe(true));
        fireEvent.keyDown(window, { key: 'Escape' });

        await waitFor(() => expect(trigger.matches(':focus')).toBe(true));
        expect(screen.queryByRole('dialog', { name: 'Find a destination' })).toBeNull();
    });
});

function renderCommandSearch() {
    const view = render(
        <DashboardCommandSearch
            guildId='guild-1'
            guilds={[
                { id: 'guild-1', name: 'Alpha Guild' },
                { id: 'guild-2', name: 'Beta Guild' },
            ]}
            pathname='/dashboard/guild-1/access/reaction-roles'>
            <DashboardCommandSearchTrigger />
        </DashboardCommandSearch>
    );

    views.push(view);

    return view;
}
