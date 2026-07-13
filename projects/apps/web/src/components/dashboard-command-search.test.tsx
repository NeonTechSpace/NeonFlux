// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardCommandSearch, DashboardCommandSearchTrigger } from './dashboard-command-search.js';

vi.mock('@tanstack/react-router', async () => {
    const { createElement } = await import('react');

    return {
        Link: ({
            to,
            state,
            preload: _preload,
            children,
            ...props
        }: {
            to: string;
            state?: (current: { __tempKey?: string }) => {
                dashboardGuildPreview?: { id?: string };
                dashboardGuildSourcePreview?: { id?: string };
            };
            preload?: unknown;
            children: ReactNode;
        }) => {
            const previewState = state?.({ __tempKey: 'test' });

            return createElement(
                'a',
                {
                    ...props,
                    href: to,
                    'data-preview-guild': previewState?.dashboardGuildPreview?.id,
                    'data-preview-source-guild': previewState?.dashboardGuildSourcePreview?.id,
                },
                children
            );
        },
    };
});

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
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
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

        const betaGuild = screen.getByRole('link', { name: /Beta Guild/u });
        expect(betaGuild.getAttribute('href')).toBe('/dashboard/guild-2/messaging/message-builder');
        expect(betaGuild.getAttribute('data-preview-guild')).toBe('guild-2');
        expect(betaGuild.getAttribute('data-preview-source-guild')).toBe('guild-1');
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

    it('groups results and owns active-result keyboard navigation', async () => {
        renderCommandSearch();
        fireEvent.click(screen.getByRole('button', { name: 'Search dashboard' }));

        const searchInput = await screen.findByRole('searchbox', { name: 'Search dashboard' });
        expect(screen.getByText('Tools')).toBeDefined();
        expect(screen.getByText('Servers')).toBeDefined();

        fireEvent.change(searchInput, { target: { value: 'command prefix' } });
        const settings = screen.getByRole('link', { name: /Command Prefix/u });
        await waitFor(() => expect(settings.getAttribute('data-active')).not.toBeNull());
        expect(searchInput.getAttribute('aria-activedescendant')).toBe(settings.id);

        fireEvent.change(searchInput, { target: { value: 'guild' } });
        const alpha = screen.getByRole('link', { name: /Alpha Guild/u });
        const beta = screen.getByRole('link', { name: /Beta Guild/u });

        await waitFor(() => expect(alpha.getAttribute('data-active')).not.toBeNull());
        fireEvent.keyDown(searchInput, { key: 'End' });
        expect(beta.getAttribute('data-active')).not.toBeNull();
        expect(searchInput.getAttribute('aria-activedescendant')).toBe(beta.id);

        fireEvent.keyDown(searchInput, { key: 'Home' });
        expect(alpha.getAttribute('data-active')).not.toBeNull();
        fireEvent.keyDown(searchInput, { key: 'ArrowUp' });
        expect(beta.getAttribute('data-active')).not.toBeNull();
        fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
        expect(alpha.getAttribute('data-active')).not.toBeNull();

        beta.addEventListener('click', (event) => event.preventDefault(), { once: true });
        fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
        fireEvent.keyDown(searchInput, { key: 'Enter' });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Find a destination' })).toBeNull());
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
            pathname='/dashboard/guild-1/messaging/message-builder'>
            <DashboardCommandSearchTrigger />
        </DashboardCommandSearch>
    );

    views.push(view);

    return view;
}
