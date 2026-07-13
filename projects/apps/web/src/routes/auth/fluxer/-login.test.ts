import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
