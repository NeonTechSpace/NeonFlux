import { describe, expect, it } from 'vitest';

import { publicAuthEnv } from './convex-auth-test-fixtures.js';
import { formatConvexAuthConfigValidation, validateConvexAuthConfigEnv } from './convex-auth-config-validate.js';

describe('validateConvexAuthConfigEnv', () => {
    it('validates three isolated public providers', () => {
        const validation = validateConvexAuthConfigEnv(publicAuthEnv());
        expect(validation.providers.map(({ kind }) => kind)).toEqual(['bot', 'web', 'user']);
        expect(formatConvexAuthConfigValidation(validation)).toContain('No Convex JWT private key is present.');
    });

    it('rejects private signing material in Convex env', () => {
        expect(() =>
            validateConvexAuthConfigEnv({
                ...publicAuthEnv(),
                NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY: 'private',
            })
        ).toThrow('Forbidden: NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY');
    });
});
