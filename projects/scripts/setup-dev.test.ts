import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';

import { createConvexPrivateKeyEnvValue } from './generate-convex-private-key.js';
import { buildDevEnvSetupPlan } from './setup-dev.js';

const privateKey = createConvexPrivateKeyEnvValue();
const generators = {
    privateKey: () => privateKey,
    sessionSecret: () => 's'.repeat(43),
    tokenEncryptionKey: () => 't'.repeat(43),
};

describe('buildDevEnvSetupPlan', () => {
    it('fills local auth material without replacing populated application values', () => {
        const source = [
            '# local configuration',
            'FLUXER_APP_ID=existing-app',
            'FLUXER_CLIENT_SECRET=',
            'FLUXER_BOT_TOKEN=',
            'SESSION_SECRET=',
            '',
        ].join('\n');

        const plan = buildDevEnvSetupPlan(source, generators);
        const env = parseEnv(plan.content);

        expect(env.FLUXER_APP_ID).toBe('existing-app');
        expect(env.SESSION_SECRET).toBe('s'.repeat(43));
        expect(env.NEONFLUX_BOT_AUTH_JWT_ISSUER).toBe('http://localhost:3000/auth/bot');
        expect(env.NEONFLUX_WEB_AUTH_JWT_ISSUER).toBe('http://localhost:3000/auth/web');
        expect(env.NEONFLUX_USER_AUTH_JWT_ISSUER).toBe('http://localhost:3000/auth/user');
        expect(env.NEONFLUX_BOT_AUTH_JWT_JWKS).toMatch(/^data:application\/json/);
        expect(env.NEONFLUX_WEB_AUTH_JWT_JWKS).toMatch(/^data:application\/json/);
        expect(env.NEONFLUX_USER_AUTH_JWT_JWKS).toMatch(/^data:application\/json/);
        expect(plan.missingExternalNames).toEqual(['FLUXER_CLIENT_SECRET', 'FLUXER_BOT_TOKEN']);
        expect(plan.content).toContain('# local configuration');
    });

    it('refuses a public key that has no matching private key', () => {
        expect(() =>
            buildDevEnvSetupPlan(
                'NEONFLUX_BOT_AUTH_JWT_JWKS=data:application/json,%7B%22keys%22%3A%5B%5D%7D\n',
                generators
            )
        ).toThrow(/NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY is blank/u);
    });

    it('refuses duplicate target entries instead of editing an ambiguous file', () => {
        expect(() => buildDevEnvSetupPlan('SESSION_SECRET=\nSESSION_SECRET=\n', generators)).toThrow(
            /duplicate SESSION_SECRET entries/u
        );
    });
});
