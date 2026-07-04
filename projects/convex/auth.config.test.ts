import { describe, expect, it } from 'vitest';

import { createAuthConfigForEnv } from './auth.config.js';

describe('createAuthConfigForEnv', () => {
    it('allows local typecheck without Convex deployment intent', () => {
        expect(createAuthConfigForEnv({})).toEqual({ providers: [] });
    });

    it('creates the custom JWT provider when complete auth config is present', () => {
        const jwks = publicJwksDataUri();

        expect(
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: ' neonflux-convex ',
                NEONFLUX_AUTH_JWT_ISSUER: ' https://neonflux.example ',
                NEONFLUX_AUTH_JWT_JWKS: ` ${jwks} `,
            })
        ).toEqual({
            providers: [
                {
                    algorithm: 'RS256',
                    applicationID: 'neonflux-convex',
                    issuer: 'https://neonflux.example',
                    jwks,
                    type: 'customJwt',
                },
            ],
        });
    });

    it('uses configured inline JWKS instead of deriving a remote issuer URL', () => {
        const jwks = ` ${publicJwksDataUri()} `;

        expect(
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                NEONFLUX_AUTH_JWT_JWKS: jwks,
            })
        ).toEqual({
            providers: [
                {
                    algorithm: 'RS256',
                    applicationID: 'neonflux-convex',
                    issuer: 'https://neonflux.example/auth',
                    jwks: jwks.trim(),
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

    it('fails closed when issuer and audience are configured without public JWKS', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example',
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS is required for Convex auth config');
    });

    it('rejects malformed issuer URLs when auth config is active', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'not-a-url',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
            })
        ).toThrow('NEONFLUX_AUTH_JWT_ISSUER must be a valid HTTP or HTTPS URL');
    });

    it('rejects Fluxer OAuth hosts as NeonFlux issuers', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
            })
        ).toThrow('NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host');
    });

    it('rejects malformed JWKS config when auth config is active', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example',
                NEONFLUX_AUTH_JWT_JWKS: 'not-a-url',
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS must be a valid HTTP(S) URL or JWKS data URI');
    });

    it('rejects inline JWKS with private key parameters', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example',
                NEONFLUX_AUTH_JWT_JWKS: `data:application/json,${encodeURIComponent(
                    JSON.stringify({ keys: [{ d: 'private', kid: 'test' }] })
                )}`,
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS exposes private JWK parameter "d"');
    });

    it('rejects inline JWKS without usable RSA public key material', () => {
        expect(() =>
            createAuthConfigForEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example',
                NEONFLUX_AUTH_JWT_JWKS: `data:application/json,${encodeURIComponent(
                    JSON.stringify({ keys: [{ alg: 'RS256', e: 'AQAB', kid: 'test', kty: 'RSA', use: 'sig' }] })
                )}`,
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS key at index 0 must include public RSA parameter "n"');
    });
});

function publicJwksDataUri(): string {
    return `data:application/json,${encodeURIComponent(
        JSON.stringify({
            keys: [
                {
                    alg: 'RS256',
                    e: 'AQAB',
                    kid: 'test-key',
                    kty: 'RSA',
                    n: 'test-modulus',
                    use: 'sig',
                },
            ],
        })
    )}`;
}
