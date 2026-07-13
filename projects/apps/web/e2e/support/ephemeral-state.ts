import { resolve } from 'node:path';

export const e2eEphemeralSentinel = 'neonflux-e2e-ephemeral-v1';
export const e2eProjectPrefix = 'neonflux-e2e-';

export type EphemeralConvexState = {
    backendPort: number;
    composeFiles: string[];
    envPath: string;
    projectName: string;
    sentinel: typeof e2eEphemeralSentinel;
    sitePort: number;
    startedAt: string;
    workspaceDirectory: string;
};

export function requireEphemeralSentinel(environment: NodeJS.ProcessEnv): void {
    if (environment.NEONFLUX_E2E_EPHEMERAL_SENTINEL !== e2eEphemeralSentinel) {
        throw new Error('Refusing the E2E operation without the ephemeral-test sentinel.');
    }
}

export function validateEphemeralConvexState(value: unknown, expectedWorkspace: string): EphemeralConvexState {
    if (!value || typeof value !== 'object') throw new Error('Ephemeral Convex state is invalid.');
    const state = value as Record<string, unknown>;

    if (state.sentinel !== e2eEphemeralSentinel) throw new Error('Ephemeral Convex state has the wrong sentinel.');
    if (typeof state.projectName !== 'string' || !state.projectName.startsWith(e2eProjectPrefix)) {
        throw new Error('Ephemeral Convex state has an unsafe Compose project name.');
    }
    if (
        typeof state.workspaceDirectory !== 'string' ||
        resolve(state.workspaceDirectory) !== resolve(expectedWorkspace)
    ) {
        throw new Error('Ephemeral Convex state belongs to another workspace.');
    }
    if (!isSafePort(state.backendPort) || !isSafePort(state.sitePort)) {
        throw new Error('Ephemeral Convex state has an unsafe port.');
    }
    if (!Array.isArray(state.composeFiles) || !state.composeFiles.every((file) => typeof file === 'string')) {
        throw new Error('Ephemeral Convex state has invalid Compose files.');
    }
    if (typeof state.envPath !== 'string' || typeof state.startedAt !== 'string') {
        throw new Error('Ephemeral Convex state is incomplete.');
    }

    return state as EphemeralConvexState;
}

function isSafePort(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65_535;
}
