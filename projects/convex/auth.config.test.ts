import { describe, expect, it } from 'vitest';

import { createAuthConfigForEnv } from './auth.config.js';

const jwks = publicJwksDataUri();

describe('createAuthConfigForEnv', () => {
    it('keeps auth disabled when no provider configuration is present', () => {
        expect(createAuthConfigForEnv({})).toEqual({ providers: [] });
    });

    it('configures distinct bot, web, and user providers', () => {
        const config = createAuthConfigForEnv(validAuthEnv());

        expect(config.providers).toEqual([expectedProvider('bot'), expectedProvider('web'), expectedProvider('user')]);
    });

    it('rejects a partially configured provider set', () => {
        const env = validAuthEnv();
        delete env.NEONFLUX_BOT_AUTH_JWT_ISSUER;

        expect(() => createAuthConfigForEnv(env)).toThrow(
            'NEONFLUX_BOT_AUTH_JWT_ISSUER is required for Convex auth config'
        );
    });

    it('rejects shared provider issuers', () => {
        const env = validAuthEnv();
        env.NEONFLUX_WEB_AUTH_JWT_ISSUER = env.NEONFLUX_BOT_AUTH_JWT_ISSUER;

        expect(() => createAuthConfigForEnv(env)).toThrow('Bot, web, and user Convex JWT issuers must be distinct');
    });

    it('rejects private key material in any provider JWKS', () => {
        const env = validAuthEnv();
        env.NEONFLUX_USER_AUTH_JWT_JWKS = `data:application/json,${encodeURIComponent(
            JSON.stringify({ keys: [{ ...publicJwk(), d: 'private' }] })
        )}`;

        expect(() => createAuthConfigForEnv(env)).toThrow(
            'NEONFLUX_USER_AUTH_JWT_JWKS exposes private JWK parameter "d"'
        );
    });
});

function validAuthEnv(): Record<string, string | undefined> & Parameters<typeof createAuthConfigForEnv>[0] {
    return {
        NEONFLUX_BOT_AUTH_JWT_AUDIENCE: 'neonflux-convex-bot',
        NEONFLUX_BOT_AUTH_JWT_ISSUER: 'https://neonflux.example/bot',
        NEONFLUX_BOT_AUTH_JWT_JWKS: jwks,
        NEONFLUX_WEB_AUTH_JWT_AUDIENCE: 'neonflux-convex-web',
        NEONFLUX_WEB_AUTH_JWT_ISSUER: 'https://neonflux.example/web',
        NEONFLUX_WEB_AUTH_JWT_JWKS: jwks,
        NEONFLUX_USER_AUTH_JWT_AUDIENCE: 'neonflux-convex-user',
        NEONFLUX_USER_AUTH_JWT_ISSUER: 'https://neonflux.example/user',
        NEONFLUX_USER_AUTH_JWT_JWKS: jwks,
    };
}

function expectedProvider(kind: 'bot' | 'user' | 'web') {
    return {
        algorithm: 'RS256',
        applicationID: `neonflux-convex-${kind}`,
        issuer: `https://neonflux.example/${kind}`,
        jwks,
        type: 'customJwt',
    };
}

function publicJwksDataUri(): string {
    return `data:application/json,${encodeURIComponent(JSON.stringify({ keys: [publicJwk()] }))}`;
}

function publicJwk() {
    return {
        alg: 'RS256',
        e: 'AQAB',
        kid: 'test-key',
        kty: 'RSA',
        n: 'abc123',
        use: 'sig',
    };
}
