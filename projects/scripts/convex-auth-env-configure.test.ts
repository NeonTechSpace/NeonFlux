import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';
import {
    assertConvexAuthEnvConfigureMode,
    createConvexAuthEnvPlan,
    createConvexAuthEnvSetOperations,
    createDeploymentArgs,
    formatConvexAuthEnvPlan,
    parseConvexAuthEnvConfigureArgs,
    requireConvexAuthEnvApplyConfirmation,
} from './convex-auth-env-configure.js';

describe('createConvexAuthEnvPlan', () => {
    it('plans only public Convex auth env values', () => {
        const plan = createConvexAuthEnvPlan({
            CONVEX_DEPLOYMENT: 'dev:target',
            NEONFLUX_AUTH_JWT_AUDIENCE: ' neonflux-convex ',
            NEONFLUX_AUTH_JWT_ISSUER: ' https://neonflux.example/auth ',
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: createPrivateKeyPem(),
        });

        expect(plan).toMatchObject({
            audience: 'neonflux-convex',
            deployment: 'dev:target',
            deploymentLabel: 'dev:target',
            issuer: 'https://neonflux.example/auth',
            keyIds: ['neonflux-convex-auth'],
            names: ['NEONFLUX_AUTH_JWT_ISSUER', 'NEONFLUX_AUTH_JWT_AUDIENCE', 'NEONFLUX_AUTH_JWT_JWKS'],
        });
        expect(parseNeonFluxJwksDataUri(plan.jwksDataUri).keys[0]).not.toHaveProperty('d');
    });

    it('supports an explicit issuer override without using stale env issuer', () => {
        const plan = createConvexAuthEnvPlan(
            {
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app',
                NEONFLUX_AUTH_JWT_PRIVATE_KEY: createPrivateKeyPem(),
            },
            {
                issuer: 'http://localhost:3000/auth',
            }
        );

        expect(plan.issuer).toBe('http://localhost:3000/auth');
    });

    it('rejects Fluxer OAuth hosts as NeonFlux issuers', () => {
        expect(() =>
            createConvexAuthEnvPlan({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app',
                NEONFLUX_AUTH_JWT_PRIVATE_KEY: createPrivateKeyPem(),
            })
        ).toThrow('NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host');
    });

    it('formats dry-runs without leaking values or private key material', () => {
        const privateKeyPem = createPrivateKeyPem();
        const plan = createConvexAuthEnvPlan({
            NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
            NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: privateKeyPem,
        });
        const output = formatConvexAuthEnvPlan(plan, 'dry-run');

        expect(output).toContain('Would configure public Convex auth env');
        expect(output).toContain('Issuer: https://neonflux.example/auth');
        expect(output).toContain('Audience: neonflux-convex');
        expect(output).toContain('JWKS key ids: neonflux-convex-auth');
        expect(output).toContain(
            'Apply order: NEONFLUX_AUTH_JWT_JWKS, NEONFLUX_AUTH_JWT_AUDIENCE, NEONFLUX_AUTH_JWT_ISSUER'
        );
        expect(output).toContain('NEONFLUX_AUTH_JWT_JWKS');
        expect(output).toContain('NEONFLUX_AUTH_JWT_PRIVATE_KEY is not sent to Convex');
        expect(output).toContain(
            'Next: rerun with --deployment <target>; --apply requires an explicit deployment and matching confirmation'
        );
        expect(output).toContain('After apply, make the local or protected deploy environment match');
        expect(output).not.toContain(plan.jwksDataUri);
        expect(output).not.toContain(privateKeyPem);
    });

    it('formats deployment dry-runs with the required apply confirmation flag', () => {
        const plan = createConvexAuthEnvPlan({
            CONVEX_DEPLOYMENT: 'dev:target',
            NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
            NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: createPrivateKeyPem(),
        });
        const output = formatConvexAuthEnvPlan(plan, 'dry-run');

        expect(output).toContain(
            'Next: review the deployment and issuer, then rerun with --apply --confirm-apply-target dev:target only after approval'
        );
        expect(output).not.toContain(plan.jwksDataUri);
    });

    it('formats applied plans with the required follow-up gates', () => {
        const plan = createConvexAuthEnvPlan({
            CONVEX_DEPLOYMENT: 'dev:target',
            NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
            NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: createPrivateKeyPem(),
        });
        const output = formatConvexAuthEnvPlan(plan, 'apply');

        expect(output).toContain('Configured public Convex auth env');
        expect(output).toContain(
            'Next: ensure the local or protected deploy environment has the same public auth values'
        );
        expect(output).toContain('Then run: pnpm convex:validate-auth-config');
        expect(output).toContain('Then run: pnpm convex:check-auth-env -- --deployment dev:target --compare-deploy-env');
        expect(output).toContain('Then deploy Convex functions/auth config for this environment');
        expect(output).toContain('Then run: pnpm convex:check-auth-env -- --deployment dev:target');
        expect(output).toContain('For local/dev rehearsal, run: pnpm convex:dev:once');
        expect(output).not.toContain(plan.jwksDataUri);
    });
});

describe('requireConvexAuthEnvApplyConfirmation', () => {
    it('requires an explicit deployment before applying', () => {
        expect(() =>
            requireConvexAuthEnvApplyConfirmation(
                {
                    deploymentLabel: 'default dev deployment',
                },
                'dev:target'
            )
        ).toThrow('--apply requires explicit --deployment <target>');
    });

    it('requires an exact target confirmation before applying', () => {
        expect(() =>
            requireConvexAuthEnvApplyConfirmation(
                {
                    deployment: 'dev:target',
                    deploymentLabel: 'dev:target',
                },
                undefined
            )
        ).toThrow('--apply requires --confirm-apply-target <target>');
    });

    it('rejects target confirmation mismatches', () => {
        expect(() =>
            requireConvexAuthEnvApplyConfirmation(
                {
                    deployment: 'dev:target',
                    deploymentLabel: 'dev:target',
                },
                'prod:target'
            )
        ).toThrow('Apply confirmation target prod:target does not match deployment dev:target');
    });

    it('accepts a matching target confirmation', () => {
        expect(() =>
            requireConvexAuthEnvApplyConfirmation(
                {
                    deployment: 'dev:target',
                    deploymentLabel: 'dev:target',
                },
                ' dev:target '
            )
        ).not.toThrow();
    });
});

describe('assertConvexAuthEnvConfigureMode', () => {
    it('rejects apply confirmations during dry-run mode', () => {
        expect(() =>
            assertConvexAuthEnvConfigureMode({
                apply: false,
                confirmApplyTarget: 'dev:target',
                deployment: 'dev:target',
            })
        ).toThrow('--confirm-apply-target requires --apply');
    });

    it('requires explicit deployment selection before apply mode', () => {
        expect(() =>
            assertConvexAuthEnvConfigureMode({
                apply: true,
                confirmApplyTarget: 'dev:target',
            })
        ).toThrow('--apply requires explicit --deployment <target>');
    });

    it('accepts apply mode with an explicit deployment and confirmation', () => {
        expect(() =>
            assertConvexAuthEnvConfigureMode({
                apply: true,
                confirmApplyTarget: 'dev:target',
                deployment: ' dev:target ',
            })
        ).not.toThrow();
    });
});

describe('createConvexAuthEnvSetOperations', () => {
    it('sets public JWKS before changing issuer to reduce partial apply risk', () => {
        const plan = createConvexAuthEnvPlan({
            CONVEX_DEPLOYMENT: 'dev:target',
            NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
            NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: createPrivateKeyPem(),
        });

        expect(createConvexAuthEnvSetOperations(plan).map((operation) => operation.name)).toEqual([
            'NEONFLUX_AUTH_JWT_JWKS',
            'NEONFLUX_AUTH_JWT_AUDIENCE',
            'NEONFLUX_AUTH_JWT_ISSUER',
        ]);
    });
});

describe('parseConvexAuthEnvConfigureArgs', () => {
    it('rejects duplicate target-changing options before apply can run', () => {
        expect(() =>
            parseConvexAuthEnvConfigureArgs(['--deployment', 'dev:target', '--deployment', 'prod:target'])
        ).toThrow('--deployment was provided multiple times');

        expect(() =>
            parseConvexAuthEnvConfigureArgs([
                '--confirm-apply-target',
                'dev:target',
                '--confirm-apply-target',
                'prod:target',
            ])
        ).toThrow('--confirm-apply-target was provided multiple times');
    });

    it('rejects duplicate public auth value overrides', () => {
        expect(() =>
            parseConvexAuthEnvConfigureArgs([
                '--issuer',
                'https://one.example/auth',
                '--issuer',
                'https://two.example/auth',
            ])
        ).toThrow('--issuer was provided multiple times');

        expect(() => parseConvexAuthEnvConfigureArgs(['--audience', 'one', '--audience', 'two'])).toThrow(
            '--audience was provided multiple times'
        );
    });
});

describe('createDeploymentArgs', () => {
    it('passes an explicit deployment selector to the Convex CLI', () => {
        expect(createDeploymentArgs(' dev:target ')).toEqual(['--deployment', 'target']);
        expect(createDeploymentArgs('team:project:staging')).toEqual(['--deployment', 'team:project:staging']);
        expect(createDeploymentArgs(undefined)).toEqual([]);
    });
});

function createPrivateKeyPem(): string {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    return privateKey.export({ format: 'pem', type: 'pkcs8' });
}
