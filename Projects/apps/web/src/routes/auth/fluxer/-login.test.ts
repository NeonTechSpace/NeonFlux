// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FluxerLoginFallback } from '../../../components/fluxer-login-fallback.js';
import { FLUXER_OAUTH_STATE_COOKIE_NAME } from '../../../server/oauth-state.js';
import { handleFluxerLoginRequest } from '../../../server/fluxer-login.server.js';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('/auth/fluxer/login', () => {
    it('redirects to Fluxer OAuth and sets a state cookie', () => {
        vi.stubEnv('APP_ENV', 'development');
        vi.stubEnv('FLUXER_APP_ID', 'app-id');
        vi.stubEnv('FLUXER_OAUTH_REDIRECT_URL', 'http://localhost:3000/auth/fluxer/callback');

        const response = handleFluxerLoginRequest();

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toContain('https://web.fluxer.app/oauth2/authorize');
        expect(response.headers.getSetCookie()[0]).toContain(`${FLUXER_OAUTH_STATE_COOKIE_NAME}=`);
    });

    it('renders a document-navigation fallback for client-side visits', () => {
        render(createElement(FluxerLoginFallback));

        const link = screen.getByRole('link', { name: 'Continue to Fluxer login' });

        expect(screen.getByRole('heading', { name: 'Redirecting to Fluxer...' })).toBeTruthy();
        expect(link.getAttribute('href')).toBe('/auth/fluxer/login');
    });
});
