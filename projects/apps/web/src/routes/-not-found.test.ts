// @vitest-environment jsdom

import { RouterContextProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NotFoundPage } from '../components/not-found-page.js';
import { getRouter } from '../router.js';

vi.mock('../routeTree.gen', async () => {
    const { createRootRoute: createMockRootRoute } = await import('@tanstack/react-router');

    return {
        routeTree: createMockRootRoute(),
    };
});

describe('NotFoundPage', () => {
    it('is configured as the router default not-found component', () => {
        const router = getRouter();

        expect(router.options.defaultNotFoundComponent).toBe(NotFoundPage);
    });

    it('renders a minimal route back to the homepage', () => {
        renderWithRouter(createElement(NotFoundPage));

        const link = screen.getByRole('link', { name: 'Back to home' });

        expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
        expect(link.getAttribute('href')).toBe('/');
    });
});

function renderWithRouter(ui: ReactNode): ReturnType<typeof render> {
    const rootRoute = createRootRoute({
        component: () => ui,
    });
    const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([indexRoute]),
    });
    const providerProps = { router } as ComponentProps<typeof RouterContextProvider>;

    return render(createElement(RouterContextProvider, providerProps, ui));
}
