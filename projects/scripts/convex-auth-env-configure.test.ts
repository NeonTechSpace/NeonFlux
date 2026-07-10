import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
    createConvexAuthEnvPlan,
    createConvexAuthEnvSetOperations,
    parseConvexAuthEnvConfigureArgs,
    requireConvexAuthEnvApplyConfirmation,
} from './convex-auth-env-configure.js';

describe('Convex auth env configuration', () => {
    it('builds nine public operations from three private signers', () => {
        const plan = createConvexAuthEnvPlan(validEnv(), { deployment: 'dev:target' });

        expect(plan.providers.map(({ kind }) => kind)).toEqual(['bot', 'web', 'user']);
        expect(createConvexAuthEnvSetOperations(plan)).toHaveLength(9);
        expect(plan.operations.every(({ name }) => !name.endsWith('PRIVATE_KEY'))).toBe(true);
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
