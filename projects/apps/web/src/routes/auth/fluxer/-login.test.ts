// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { fluxerLoginRouteOptions } from './login.js';

describe('/auth/fluxer/login', () => {
    it('keeps the server GET handler for Fluxer OAuth startup', () => {
        expect(typeof fluxerLoginRouteOptions.server.handlers.GET).toBe('function');
    });

    it('renders a document-navigation fallback for client-side visits', () => {
        const Component = fluxerLoginRouteOptions.component;

        render(createElement(Component));

        const link = screen.getByRole('link', { name: 'Continue to Fluxer login' });

        expect(screen.getByRole('heading', { name: 'Redirecting to Fluxer...' })).toBeTruthy();
        expect(link.getAttribute('href')).toBe('/auth/fluxer/login');
    });
});
