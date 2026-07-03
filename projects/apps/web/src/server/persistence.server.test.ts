import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isConvexRuntimePersistence } from '@neonflux/persistence';

import { closeWebPersistence, getWebPersistence } from './persistence.server.js';

afterEach(async () => {
    await closeWebPersistence();
    vi.unstubAllEnvs();
});

describe('getWebPersistence', () => {
    it('returns the same cached client on repeated calls', async () => {
        stubConvexEnv();

        const firstClient = await getWebPersistence();
        const secondClient = await getWebPersistence();

        expect(secondClient).toBe(firstClient);
    });

    it('creates a new client after the cached client is closed', async () => {
        stubConvexEnv();

        const firstClient = await getWebPersistence();

        await closeWebPersistence();

        const secondClient = await getWebPersistence();

        expect(secondClient).not.toBe(firstClient);
        expect(isConvexRuntimePersistence(secondClient)).toBe(true);
    });

    it('creates a Convex service client when config is complete', async () => {
        stubConvexEnv();

        const client = await getWebPersistence();

        expect(isConvexRuntimePersistence(client)).toBe(true);
        if (!isConvexRuntimePersistence(client)) throw new Error('Expected Convex persistence.');
        expect(client.db.kind).toBe('convex');
    });

    it('requires complete Convex config', async () => {
        vi.stubEnv('APP_ENV', 'production');

        await expect(getWebPersistence()).rejects.toThrow('Complete Convex config is required');
    });
});

function stubConvexEnv(): void {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('CONVEX_DEPLOYMENT', 'dev:neonflux');
    vi.stubEnv('CONVEX_DEPLOY_KEY', 'deploy-key');
    vi.stubEnv('CONVEX_URL', 'https://neonflux.convex.cloud');
    vi.stubEnv('VITE_CONVEX_URL', 'https://neonflux.convex.cloud');
    vi.stubEnv('NEONFLUX_AUTH_JWT_AUDIENCE', 'neonflux-convex');
    vi.stubEnv('NEONFLUX_AUTH_JWT_ISSUER', 'https://neonflux.example');
    vi.stubEnv('NEONFLUX_AUTH_JWT_PRIVATE_KEY', createPrivateKeyPem());
}

function createPrivateKeyPem(): string {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
}
