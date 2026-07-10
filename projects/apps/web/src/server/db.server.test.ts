import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isConvexRuntimeDb } from '@neonflux/db';

import { closeWebDb, getWebDb } from './db.server.js';

afterEach(async () => {
    await closeWebDb();
    vi.unstubAllEnvs();
});

describe('getWebDb', () => {
    it('returns the same cached client on repeated calls', async () => {
        stubConvexEnv();

        const firstClient = await getWebDb();
        const secondClient = await getWebDb();

        expect(secondClient).toBe(firstClient);
    });

    it('creates a new client after the cached client is closed', async () => {
        stubConvexEnv();

        const firstClient = await getWebDb();

        await closeWebDb();

        const secondClient = await getWebDb();

        expect(secondClient).not.toBe(firstClient);
        expect(isConvexRuntimeDb(secondClient)).toBe(true);
    });

    it('creates a Convex service client when config is complete', async () => {
        stubConvexEnv();

        const client = await getWebDb();

        expect(isConvexRuntimeDb(client)).toBe(true);
        if (!isConvexRuntimeDb(client)) throw new Error('Expected Convex database.');
        expect(client.db.kind).toBe('convex');
    });

    it('requires complete Convex config', async () => {
        vi.stubEnv('APP_ENV', 'production');

        await expect(getWebDb()).rejects.toThrow('Complete Convex config is required');
    });
});

function stubConvexEnv(): void {
    const audience = 'neonflux-convex-web';
    const issuer = 'https://neonflux.example/web';
    const privateKeyPem = createPrivateKeyPem();

    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('CONVEX_DEPLOYMENT', 'dev:neonflux');
    vi.stubEnv('CONVEX_URL', 'https://neonflux.convex.cloud');
    vi.stubEnv('VITE_CONVEX_URL', 'https://neonflux.convex.cloud');
    vi.stubEnv('NEONFLUX_WEB_AUTH_JWT_AUDIENCE', audience);
    vi.stubEnv('NEONFLUX_WEB_AUTH_JWT_ISSUER', issuer);
    vi.stubEnv('NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY', privateKeyPem);
}

function createPrivateKeyPem(): string {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
}
