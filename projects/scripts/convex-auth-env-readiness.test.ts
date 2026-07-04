import { describe, expect, it } from 'vitest';

import {
    compareConvexAuthEnvValues,
    createDeploymentArgs,
    createRemediationLines,
    evaluateDeployConvexAuthEnvValues,
    evaluateConvexAuthEnvNames,
    evaluateConvexAuthEnvValues,
    parseConvexAuthEnvReadinessArgs,
} from './convex-auth-env-readiness.js';

describe('evaluateConvexAuthEnvNames', () => {
    it('accepts issuer, audience, and public JWKS without private key material', () => {
        expect(
            evaluateConvexAuthEnvNames([
                'NEONFLUX_AUTH_JWT_AUDIENCE',
                'NEONFLUX_AUTH_JWT_ISSUER',
                'NEONFLUX_AUTH_JWT_JWKS',
            ])
        ).toMatchObject({
            forbiddenPresent: [],
            missing: [],
            ok: true,
        });
    });

    it('requires public JWKS in Convex env', () => {
        expect(evaluateConvexAuthEnvNames(['NEONFLUX_AUTH_JWT_AUDIENCE', 'NEONFLUX_AUTH_JWT_ISSUER'])).toMatchObject({
            forbiddenPresent: [],
            missing: ['NEONFLUX_AUTH_JWT_JWKS'],
            ok: false,
        });
    });

    it('rejects private signing key material in Convex env', () => {
        expect(
            evaluateConvexAuthEnvNames([
                'NEONFLUX_AUTH_JWT_AUDIENCE',
                'NEONFLUX_AUTH_JWT_ISSUER',
                'NEONFLUX_AUTH_JWT_JWKS',
                'NEONFLUX_AUTH_JWT_PRIVATE_KEY',
            ])
        ).toMatchObject({
            forbiddenPresent: ['NEONFLUX_AUTH_JWT_PRIVATE_KEY'],
            missing: [],
            ok: false,
        });
    });
});

describe('evaluateConvexAuthEnvValues', () => {
    it('accepts valid public Convex auth values without exposing JWKS content', () => {
        expect(
            evaluateConvexAuthEnvValues({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
            })
        ).toMatchObject({
            audience: 'neonflux-convex',
            issuer: 'https://neonflux.example/auth',
            jwksDescription: 'inline data URI (1 key)',
            missing: [],
            ok: true,
            valueErrors: [],
        });
    });

    it('rejects Fluxer-owned target issuer values', () => {
        expect(
            evaluateConvexAuthEnvValues({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
            })
        ).toMatchObject({
            ok: false,
            valueErrors: ['NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host'],
        });
    });

    it('validates present target values even when another required value is missing', () => {
        expect(
            evaluateConvexAuthEnvValues({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app',
            })
        ).toMatchObject({
            missing: ['NEONFLUX_AUTH_JWT_JWKS'],
            ok: false,
            valueErrors: ['NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host'],
        });
    });

    it('rejects private JWK parameters in public target JWKS values', () => {
        expect(
            evaluateConvexAuthEnvValues({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                NEONFLUX_AUTH_JWT_JWKS: `data:application/json,${encodeURIComponent(
                    JSON.stringify({ keys: [{ d: 'private', kid: 'leak' }] })
                )}`,
            })
        ).toMatchObject({
            ok: false,
            valueErrors: ['NEONFLUX_AUTH_JWT_JWKS exposes private JWK parameter "d"'],
        });
    });
});

describe('compareConvexAuthEnvValues', () => {
    it('accepts matching public target and deploy env values', () => {
        const values = {
            NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
            NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
            NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
        };

        expect(compareConvexAuthEnvValues(values, values)).toEqual([]);
    });

    it('reports mismatched deploy env names without printing values', () => {
        expect(
            compareConvexAuthEnvValues(
                {
                    NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                    NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                    NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
                },
                {
                    NEONFLUX_AUTH_JWT_AUDIENCE: 'other-audience',
                    NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                }
            )
        ).toEqual(['Deploy env mismatch: NEONFLUX_AUTH_JWT_AUDIENCE']);
    });

    it('does not report a mismatch for target values that are not set yet', () => {
        expect(
            compareConvexAuthEnvValues(
                {
                    NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                    NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app',
                },
                {
                    NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                    NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                    NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
                }
            )
        ).toEqual(['Deploy env mismatch: NEONFLUX_AUTH_JWT_ISSUER']);
    });
});

describe('evaluateDeployConvexAuthEnvValues', () => {
    it('reports deploy env public auth gaps even before target auth values are ready', () => {
        expect(
            evaluateDeployConvexAuthEnvValues({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app',
            })
        ).toEqual([
            'Deploy env missing: NEONFLUX_AUTH_JWT_JWKS',
            'Deploy env invalid: NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host',
        ]);
    });
});

describe('createRemediationLines', () => {
    it('prints the target-confirmed apply and bounded local/dev rehearsal gates for selected deployments', () => {
        expect(createRemediationLines('dev:target')).toEqual([
            'Next: pnpm convex:configure-auth-env -- --issuer <stable-NeonFlux-issuer> --deployment dev:target',
            'After approval, apply with --apply --confirm-apply-target dev:target, then make the local or protected deploy environment match the same public auth values.',
            'Then run pnpm convex:validate-auth-config and pnpm convex:check-auth-env -- --compare-deploy-env.',
            'Deploy Convex functions/auth config, then rerun pnpm convex:check-auth-env and pnpm convex:dev:once for local/dev rehearsal.',
        ]);
    });

    it('keeps apply target selection explicit when no deployment is selected', () => {
        expect(createRemediationLines(undefined)).toEqual([
            'Next: pnpm convex:configure-auth-env -- --issuer <stable-NeonFlux-issuer>',
            'After approval, rerun with --deployment <target> plus --apply --confirm-apply-target <target>, then make the local or protected deploy environment match the same public auth values.',
            'Then run pnpm convex:validate-auth-config and pnpm convex:check-auth-env -- --compare-deploy-env.',
            'Deploy Convex functions/auth config, then rerun pnpm convex:check-auth-env and pnpm convex:dev:once for local/dev rehearsal.',
        ]);
    });
});

describe('parseConvexAuthEnvReadinessArgs', () => {
    it('rejects duplicate deployment and compare flags', () => {
        expect(() =>
            parseConvexAuthEnvReadinessArgs(['--deployment', 'dev:target', '--deployment', 'prod:target'])
        ).toThrow('--deployment was provided multiple times');

        expect(() => parseConvexAuthEnvReadinessArgs(['--compare-deploy-env', '--compare-deploy-env'])).toThrow(
            '--compare-deploy-env was provided multiple times'
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

function publicJwksDataUri(): string {
    return `data:application/json,${encodeURIComponent(
        JSON.stringify({
            keys: [
                {
                    alg: 'RS256',
                    e: 'AQAB',
                    kid: 'test-key',
                    kty: 'RSA',
                    n: 'test-modulus',
                    use: 'sig',
                },
            ],
        })
    )}`;
}
