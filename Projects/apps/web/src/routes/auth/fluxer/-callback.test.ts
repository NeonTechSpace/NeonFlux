import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLUXER_OAUTH_STATE_COOKIE_NAME } from '../../../server/oauth-state.js';
import { fluxerCallbackRouteOptions } from './callback.js';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('/auth/fluxer/callback', () => {
    it('returns 200 and clears the state cookie when callback state is valid', async () => {
        vi.stubEnv('APP_ENV', 'development');

        const handler = getFluxerCallbackGetHandler();
        const response = await handler({
            request: createCallbackRequest(
                'http://localhost:3000/auth/fluxer/callback?code=code-value&state=state-value',
                'state-value'
            ),
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('Fluxer OAuth callback state validated.');
        expect(response.headers.get('Set-Cookie')).toBe(
            `${FLUXER_OAUTH_STATE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=0`
        );
    });

    it('returns 400 and clears the state cookie when callback state is invalid', async () => {
        vi.stubEnv('APP_ENV', 'development');

        const handler = getFluxerCallbackGetHandler();
        const response = await handler({
            request: createCallbackRequest('http://localhost:3000/auth/fluxer/callback?code=code-value', 'state-value'),
        });

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Invalid Fluxer OAuth callback.');
        expect(response.headers.get('Set-Cookie')).toBe(
            `${FLUXER_OAUTH_STATE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/auth/fluxer; Max-Age=0`
        );
    });
});

function createCallbackRequest(url: string, state: string): Request {
    return new Request(url, {
        headers: {
            Cookie: `${FLUXER_OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
        },
    });
}

function getFluxerCallbackGetHandler(): NonNullable<typeof fluxerCallbackRouteOptions.server.handlers>['GET'] {
    const handler = fluxerCallbackRouteOptions.server.handlers.GET;

    if (typeof handler !== 'function') {
        throw new Error('Fluxer callback GET handler is missing.');
    }

    return handler;
}
