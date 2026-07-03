import { describe, expect, it } from 'vitest';

import { createAuthConfigForEnv } from './auth.config.js';

describe('createAuthConfigForEnv', () => {
    it('allows local typecheck without Convex deployment intent', () => {
        expect(createAuthConfigForEnv({})).toEqual({ providers: [] });
    });

    it('creates the custom JWT provider when auth config is present', () => {
        expect(
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: ' neonflux-convex ',
                NEONFLUX_AUTH_JWT_ISSUER: ' https://neonflux.example ',
            })
        ).toEqual({
            providers: [
                {
                    algorithm: 'RS256',
                    applicationID: 'neonflux-convex',
                    issuer: 'https://neonflux.example',
                    jwks: 'https://neonflux.example/.well-known/jwks.json',
                    type: 'customJwt',
                },
            ],
        });
    });

    it('fails closed when auth audience is configured without auth issuer', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
            })
        ).toThrow('NEONFLUX_AUTH_JWT_ISSUER is required for Convex auth config');
    });

    it('fails closed when auth issuer is configured without auth audience', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example',
            })
        ).toThrow('NEONFLUX_AUTH_JWT_AUDIENCE is required for Convex auth config');
    });

    it('rejects malformed issuer URLs when auth config is active', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'not-a-url',
            })
        ).toThrow('Invalid URL');
    });
});
