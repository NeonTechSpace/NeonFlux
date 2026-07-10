import { describe, expect, it } from 'vitest';

import { publicAuthEnv } from './convex-auth-test-fixtures.js';
import {
    assertConvexCliAuthConfigReady,
    createConvexCliChildEnv,
    normalizeConvexCliArgs,
    shouldValidateConvexCliAuthConfig,
} from './convex-cli.js';

describe('Convex CLI auth boundary', () => {
    it('strips all private provider keys from the child environment', () => {
        const child = createConvexCliChildEnv({
            ...publicAuthEnv(),
            NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY: 'bot-private',
            NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY: 'web-private',
            NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY: 'user-private',
        });
        expect(Object.keys(child).filter((name) => name.endsWith('PRIVATE_KEY'))).toEqual([]);
    });

    it('requires public isolated providers for codegen, dev, and deploy', () => {
        expect(shouldValidateConvexCliAuthConfig(['codegen'])).toBe(true);
        expect(() => assertConvexCliAuthConfigReady(['codegen'], publicAuthEnv())).not.toThrow();
        expect(() => assertConvexCliAuthConfigReady(['deploy'], {})).toThrow('Convex deploy requires');
    });

    it('normalizes pnpm argument separators', () => {
        expect(normalizeConvexCliArgs(['--', 'codegen'])).toEqual(['codegen']);
    });
});
