import { describe, expect, it } from 'vitest';

import {
    assertConvexCliEnvironmentContainsNoPrivateCredentials,
    createConvexPublicAuthEnvironment,
    e2eEphemeralSentinel,
    requireEphemeralSentinel,
    validateEphemeralConvexState,
} from './ephemeral-state.js';

describe('ephemeral Convex ownership guards', () => {
    it('requires the exact sentinel before mutable orchestration', () => {
        expect(() => requireEphemeralSentinel({})).toThrow(/sentinel/u);
        expect(() => requireEphemeralSentinel({ NEONFLUX_E2E_EPHEMERAL_SENTINEL: 'almost' })).toThrow(/sentinel/u);
        expect(() => requireEphemeralSentinel({ NEONFLUX_E2E_EPHEMERAL_SENTINEL: e2eEphemeralSentinel })).not.toThrow();
    });

    it('rejects state from another workspace or an unsafe project', () => {
        const state = fixtureState();
        expect(validateEphemeralConvexState(state, 'M:/workspace')).toMatchObject({
            projectName: 'neonflux-e2e-test',
        });
        expect(() => validateEphemeralConvexState({ ...state, projectName: 'neonflux' }, 'M:/workspace')).toThrow(
            /project/u
        );
        expect(() => validateEphemeralConvexState(state, 'M:/other')).toThrow(/workspace/u);
    });

    it('rejects private signing, Fluxer, session, and token-encryption credentials at the Convex CLI boundary', () => {
        expect(() =>
            assertConvexCliEnvironmentContainsNoPrivateCredentials({
                CONVEX_SELF_HOSTED_ADMIN_KEY: 'owned-admin-key',
                NEONFLUX_WEB_AUTH_JWT_JWKS: 'data:application/json,public',
            })
        ).not.toThrow();
        for (const key of [
            'NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY',
            'FLUXER_BOT_TOKEN',
            'FLUXER_CLIENT_SECRET',
            'FLUXER_TOKEN_ENCRYPTION_KEY',
            'SESSION_SECRET',
        ]) {
            expect(() => assertConvexCliEnvironmentContainsNoPrivateCredentials({ [key]: 'secret' })).toThrow(key);
        }
        expect(() => assertConvexCliEnvironmentContainsNoPrivateCredentials({ session_secret: 'secret' })).toThrow(
            /session_secret/u
        );
    });

    it('creates only public auth values for the ephemeral Convex deployment', () => {
        const environment = createConvexPublicAuthEnvironment(
            (['BOT', 'WEB', 'USER'] as const).map((provider) => ({
                audience: `audience-${provider.toLowerCase()}`,
                issuer: `https://${provider.toLowerCase()}.e2e.invalid/`,
                jwks: `data:application/json,public-${provider.toLowerCase()}`,
                provider,
            }))
        );

        expect(Object.keys(environment)).toHaveLength(9);
        expect(environment).toMatchObject({
            NEONFLUX_BOT_AUTH_JWT_AUDIENCE: 'audience-bot',
            NEONFLUX_USER_AUTH_JWT_ISSUER: 'https://user.e2e.invalid/',
            NEONFLUX_WEB_AUTH_JWT_JWKS: 'data:application/json,public-web',
        });
        expect(Object.keys(environment).some((key) => key.endsWith('_PRIVATE_KEY'))).toBe(false);
    });

    it('rejects incomplete or duplicate ephemeral auth providers', () => {
        const provider = {
            audience: 'audience-bot',
            issuer: 'https://bot.e2e.invalid/',
            jwks: 'data:application/json,public-bot',
            provider: 'BOT' as const,
        };
        expect(() => createConvexPublicAuthEnvironment([provider])).toThrow(/exactly one/u);
        expect(() => createConvexPublicAuthEnvironment([provider, provider, provider])).toThrow(/exactly one/u);
    });
});

function fixtureState() {
    return {
        backendPort: 32_110,
        composeFiles: ['compose.yml'],
        envPath: 'runtime.env',
        fixtureEnvPath: 'fixture.env',
        projectName: 'neonflux-e2e-test',
        runtimeEnvPath: 'runtime.env',
        sentinel: e2eEphemeralSentinel,
        sitePort: 32_111,
        startedAt: '2026-07-13T00:00:00.000Z',
        workspaceDirectory: 'M:/workspace',
    };
}
