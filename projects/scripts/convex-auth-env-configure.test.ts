import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
    createConvexAuthEnvPlan,
    parseConvexAuthEnvConfigureArgs,
    requireConvexAuthEnvApplyConfirmation,
} from './convex-auth-env-configure.js';

describe('Convex auth env configuration', () => {
    it('emits complete public configuration without sending private signer material', () => {
        const env = validEnv();
        const plan = createConvexAuthEnvPlan(env, { deployment: 'dev:target' });

        expect(plan.operations.map(({ name }) => name).sort()).toStrictEqual([
            'NEONFLUX_BOT_AUTH_JWT_AUDIENCE',
            'NEONFLUX_BOT_AUTH_JWT_ISSUER',
            'NEONFLUX_BOT_AUTH_JWT_JWKS',
            'NEONFLUX_USER_AUTH_JWT_AUDIENCE',
            'NEONFLUX_USER_AUTH_JWT_ISSUER',
            'NEONFLUX_USER_AUTH_JWT_JWKS',
            'NEONFLUX_WEB_AUTH_JWT_AUDIENCE',
            'NEONFLUX_WEB_AUTH_JWT_ISSUER',
            'NEONFLUX_WEB_AUTH_JWT_JWKS',
        ]);

        const jwksPayloads = plan.operations
            .filter(({ name }) => name.endsWith('_JWKS'))
            .map(({ value }) => decodeURIComponent(value));
        const publicValuesMatchSource = plan.operations
            .filter(({ name }) => !name.endsWith('_JWKS'))
            .every(({ name, value }) => value === env[name]);

        expect(jwksPayloads).toHaveLength(3);
        expect(jwksPayloads.some((payload) => /"(?:d|dp|dq|oth|p|q|qi)"\s*:/u.test(payload))).toBe(false);
        expect(publicValuesMatchSource).toBe(true);
    });

    it('rejects shared issuers', () => {
        const env = validEnv();
        env.NEONFLUX_WEB_AUTH_JWT_ISSUER = env.NEONFLUX_BOT_AUTH_JWT_ISSUER;
        expect(() => createConvexAuthEnvPlan(env)).toThrow('issuers must be distinct');
    });

    it('requires exact target confirmation before apply', () => {
        expect(() =>
            requireConvexAuthEnvApplyConfirmation(
                { deployment: 'dev:target', deploymentLabel: 'dev:target' },
                'prod:target'
            )
        ).toThrow('does not match deployment');
    });

    it('parses explicit apply arguments', () => {
        expect(
            parseConvexAuthEnvConfigureArgs([
                '--deployment',
                'dev:target',
                '--apply',
                '--confirm-apply-target',
                'dev:target',
            ])
        ).toEqual({ apply: true, confirmApplyTarget: 'dev:target', deployment: 'dev:target' });
    });
});

function validEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const kind of ['BOT', 'WEB', 'USER']) {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        env[`NEONFLUX_${kind}_AUTH_JWT_AUDIENCE`] = `neonflux-convex-${kind.toLowerCase()}`;
        env[`NEONFLUX_${kind}_AUTH_JWT_ISSUER`] = `https://neonflux.example/${kind.toLowerCase()}`;
        env[`NEONFLUX_${kind}_AUTH_JWT_PRIVATE_KEY`] = privateKey.export({ format: 'pem', type: 'pkcs8' });
    }
    return env;
}
