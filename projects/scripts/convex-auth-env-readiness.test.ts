import { describe, expect, it } from 'vitest';

import {
    compareConvexAuthEnvValues,
    evaluateConvexAuthEnvNames,
    evaluateConvexAuthEnvValues,
    parseConvexAuthEnvReadinessArgs,
} from './convex-auth-env-readiness.js';

import { publicAuthEnv } from './convex-auth-test-fixtures.js';

describe('Convex auth env readiness', () => {
    it('requires all three public provider tuples and rejects private keys', () => {
        const env = publicAuthEnv();
        const ready = evaluateConvexAuthEnvNames(Object.keys(env));
        expect(ready.ok).toBe(true);

        const forbidden = evaluateConvexAuthEnvNames([...Object.keys(env), 'NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY']);
        expect(forbidden.ok).toBe(false);
        expect(forbidden.forbiddenPresent).toEqual(['NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY']);
    });

    it('validates provider values and reports deploy mismatches', () => {
        const env = publicAuthEnv();
        expect(evaluateConvexAuthEnvValues(env).ok).toBe(true);
        expect(compareConvexAuthEnvValues(env, { ...env, NEONFLUX_WEB_AUTH_JWT_AUDIENCE: 'wrong' })).toEqual([
            'Deploy env mismatch: NEONFLUX_WEB_AUTH_JWT_AUDIENCE',
        ]);
    });

    it('parses target comparison arguments', () => {
        expect(parseConvexAuthEnvReadinessArgs(['--deployment', 'dev:target', '--compare-deploy-env'])).toEqual({
            compareDeployEnv: true,
            deployment: 'dev:target',
        });
    });
});
