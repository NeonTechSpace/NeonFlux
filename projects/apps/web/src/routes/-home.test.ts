// @vitest-environment jsdom

import { RouterContextProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { HomePage } from '../components/home-page.js';

describe('/', () => {
    it('keeps the Dashboard CTA as document navigation to the server-authorized route', () => {
        renderWithRouter(createElement(HomePage));

        expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/dashboard');
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
