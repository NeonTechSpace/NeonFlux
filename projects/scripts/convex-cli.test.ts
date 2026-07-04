import { describe, expect, it } from 'vitest';

import {
    assertConvexCliAuthConfigReady,
    createConvexCliChildEnv,
    normalizeConvexCliArgs,
    shouldValidateConvexCliAuthConfig,
} from './convex-cli.js';

describe('normalizeConvexCliArgs', () => {
    it('keeps direct Convex CLI arguments unchanged', () => {
        expect(normalizeConvexCliArgs(['dev', '--once'])).toEqual(['dev', '--once']);
    });

    it('strips the pnpm pass-through delimiter before the Convex command', () => {
        expect(normalizeConvexCliArgs(['--', 'dev', '--once'])).toEqual(['dev', '--once']);
    });

    it('strips the pnpm pass-through delimiter after a scripted Convex command', () => {
        expect(normalizeConvexCliArgs(['dev', '--', '--once', '--tail-logs', 'disable'])).toEqual([
            'dev',
            '--once',
            '--tail-logs',
            'disable',
        ]);
    });
});

describe('createConvexCliChildEnv', () => {
    it('removes the private signing key before spawning the Convex CLI', () => {
        expect(
            createConvexCliChildEnv({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_PRIVATE_KEY: 'private-key',
            })
        ).toEqual({
            NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
        });
    });
});

describe('shouldValidateConvexCliAuthConfig', () => {
    it('preflights Convex commands that prepare or publish functions', () => {
        expect(shouldValidateConvexCliAuthConfig(['codegen'])).toBe(true);
        expect(shouldValidateConvexCliAuthConfig(['deploy'])).toBe(true);
        expect(shouldValidateConvexCliAuthConfig(['dev', '--once'])).toBe(true);
    });

    it('does not preflight unrelated Convex CLI commands', () => {
        expect(shouldValidateConvexCliAuthConfig(['env', 'list'])).toBe(false);
    });
});

describe('assertConvexCliAuthConfigReady', () => {
    it('accepts publish commands when the stripped child env has public auth config', () => {
        expect(() =>
            assertConvexCliAuthConfigReady(
                ['codegen'],
                createConvexCliChildEnv({
                    NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                    NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                    NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
                    NEONFLUX_AUTH_JWT_PRIVATE_KEY: 'server-only-private-key',
                })
            )
        ).not.toThrow();
    });

    it('rejects publish commands before spawning when public auth config is missing', () => {
        expect(() =>
            assertConvexCliAuthConfigReady(['codegen'], {
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
            })
        ).toThrow(
            [
                'Convex codegen requires deploy/codegen auth config before invoking the Convex CLI.',
                'Convex auth config is not ready.',
                'Missing: NEONFLUX_AUTH_JWT_JWKS',
            ].join('\n')
        );
    });

    it('does not require auth config for unrelated Convex CLI commands', () => {
        expect(() => assertConvexCliAuthConfigReady(['env', 'list'], {})).not.toThrow();
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
