import { describe, expect, it } from 'vitest';

import { e2eEphemeralSentinel, requireEphemeralSentinel, validateEphemeralConvexState } from './ephemeral-state.js';

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
});

function fixtureState() {
    return {
        backendPort: 32_110,
        composeFiles: ['compose.yml'],
        envPath: 'runtime.env',
        projectName: 'neonflux-e2e-test',
        sentinel: e2eEphemeralSentinel,
        sitePort: 32_111,
        startedAt: '2026-07-13T00:00:00.000Z',
        workspaceDirectory: 'M:/workspace',
    };
}
