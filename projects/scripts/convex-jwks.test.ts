import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createConvexAuthJwksDataUriFromEnv } from './convex-jwks.js';

describe('createConvexAuthJwksDataUriFromEnv', () => {
    it('generates the selected provider public JWKS without private material', () => {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
        const result = createConvexAuthJwksDataUriFromEnv(
            {
                NEONFLUX_BOT_AUTH_JWT_AUDIENCE: 'neonflux-convex-bot',
                NEONFLUX_BOT_AUTH_JWT_ISSUER: 'https://neonflux.example/bot',
                NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY: privateKeyPem,
            },
            'bot'
        );
        expect(result).toContain('data:application/json');
        expect(decodeURIComponent(result)).not.toContain('"d"');
    });

    it('does not fall back to another provider signer', () => {
        expect(() => createConvexAuthJwksDataUriFromEnv({}, 'web')).toThrow(
            'NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY is required'
        );
    });
});
