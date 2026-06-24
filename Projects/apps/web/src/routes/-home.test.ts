// @vitest-environment jsdom

import { RouterContextProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { HomePage } from '../components/home-page.js';

describe('/', () => {
    it('renders the homepage entry points', () => {
        renderWithRouter(createElement(HomePage));

        expect(screen.getByRole('heading', { name: 'NeonFlux' })).toBeTruthy();
        expect(screen.getByText('A multi functional bot for Fluxer.')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/dashboard');
        expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/docs/topic');
        expect(screen.queryByText('Welcome to TanStack Start')).toBeNull();
    });
});

function renderWithRouter(ui: ReactNode) {
    const rootRoute = createRootRoute();
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
