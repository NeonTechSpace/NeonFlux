import { describe, expect, it } from 'vitest';

import { formatConvexAuthConfigValidation, validateConvexAuthConfigEnv } from './convex-auth-config-validate.js';

describe('validateConvexAuthConfigEnv', () => {
    it('accepts public deploy/codegen auth config without private key material', () => {
        expect(
            validateConvexAuthConfigEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: ' neonflux-convex ',
                NEONFLUX_AUTH_JWT_ISSUER: ' https://neonflux.example/auth ',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
            })
        ).toEqual({
            audience: 'neonflux-convex',
            issuer: 'https://neonflux.example/auth',
            jwksDescription: 'inline data URI (1 key)',
        });
    });

    it('requires issuer, audience, and public JWKS', () => {
        expect(() => validateConvexAuthConfigEnv({})).toThrow(
            'Missing: NEONFLUX_AUTH_JWT_ISSUER, NEONFLUX_AUTH_JWT_AUDIENCE, NEONFLUX_AUTH_JWT_JWKS'
        );
    });

    it('rejects private signing key material in deploy/codegen auth config', () => {
        expect(() =>
            validateConvexAuthConfigEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
                NEONFLUX_AUTH_JWT_PRIVATE_KEY: 'private-key',
            })
        ).toThrow('Forbidden: NEONFLUX_AUTH_JWT_PRIVATE_KEY');
    });

    it('rejects Fluxer OAuth hosts as NeonFlux issuers', () => {
        expect(() =>
            validateConvexAuthConfigEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
            })
        ).toThrow('NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host');
    });

    it('rejects inline JWKS with private key parameters', () => {
        expect(() =>
            validateConvexAuthConfigEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                NEONFLUX_AUTH_JWT_JWKS: `data:application/json,${encodeURIComponent(
                    JSON.stringify({ keys: [{ d: 'private', kid: 'test' }] })
                )}`,
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS exposes private JWK parameter "d"');
    });

    it('rejects inline JWKS without usable RSA public key material', () => {
        expect(() =>
            validateConvexAuthConfigEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                NEONFLUX_AUTH_JWT_JWKS: `data:application/json,${encodeURIComponent(
                    JSON.stringify({ keys: [{ alg: 'RS256', e: 'AQAB', kid: 'test', kty: 'RSA', use: 'sig' }] })
                )}`,
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS key at index 0 must include public RSA parameter "n"');
    });
});

describe('formatConvexAuthConfigValidation', () => {
    it('prints only safe auth config details', () => {
        const output = formatConvexAuthConfigValidation(
            validateConvexAuthConfigEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
            })
        );

        expect(output).toContain('Issuer: https://neonflux.example/auth');
        expect(output).toContain('Audience: neonflux-convex');
        expect(output).toContain('JWKS: inline data URI (1 key)');
        expect(output).not.toContain(publicJwksDataUri());
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
