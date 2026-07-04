import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';
import { createConvexAuthJwksDataUriFromEnv } from './convex-jwks.js';

describe('createConvexAuthJwksDataUriFromEnv', () => {
    it('generates public JWKS data URI from the server-only signing key', () => {
        const jwksDataUri = createConvexAuthJwksDataUriFromEnv({
            NEONFLUX_AUTH_JWT_AUDIENCE: ' neonflux-convex ',
            NEONFLUX_AUTH_JWT_ISSUER: ' http://localhost:3000/auth ',
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: createPrivateKeyPem(),
        });
        const jwks = parseNeonFluxJwksDataUri(jwksDataUri);

        expect(jwksDataUri).toMatch(/^data:application\/json,/);
        expect(jwks.keys).toHaveLength(1);
        expect(jwks.keys[0]).toMatchObject({
            alg: 'RS256',
            kid: 'neonflux-convex-auth',
            kty: 'RSA',
            use: 'sig',
        });
        expect(jwks.keys[0]).not.toHaveProperty('d');
        expect(jwks.keys[0]).not.toHaveProperty('p');
        expect(jwks.keys[0]).not.toHaveProperty('q');
    });

    it('requires the private signing key', () => {
        expect(() => createConvexAuthJwksDataUriFromEnv({})).toThrow(
            'NEONFLUX_AUTH_JWT_PRIVATE_KEY is required to generate NEONFLUX_AUTH_JWT_JWKS'
        );
    });
});

function createPrivateKeyPem(): string {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    return privateKey.export({ format: 'pem', type: 'pkcs8' });
}
