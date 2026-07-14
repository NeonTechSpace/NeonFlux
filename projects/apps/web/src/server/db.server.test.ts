import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BLUEPRINT_RUN_PROTOCOL_VERSION, ConvexRuntimeContractError, isConvexRuntimeDb } from '@neonflux/db';

import { closeWebDb, getWebDb } from './db.server.js';

afterEach(async () => {
    await closeWebDb();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

    it('clears a failed startup so the runtime can recover after configuration is corrected', async () => {
        vi.stubEnv('APP_ENV', 'production');

        await expect(getWebDb()).rejects.toThrow('Complete Convex config is required');

        stubConvexEnv();

        await expect(getWebDb()).resolves.toMatchObject({ serviceName: 'web' });
    });

    it('aborts a stalled runtime-contract read and lets a later startup retry succeed', async () => {
        vi.useFakeTimers();
        stubConvexEnv();
        const stalledFetch = createStalledFetch();
        vi.stubGlobal('fetch', stalledFetch);

        const firstStartup = getWebDb().catch((error: unknown) => error);
        await vi.waitFor(() => expect(stalledFetch).toHaveBeenCalledOnce());

        await vi.advanceTimersByTimeAsync(60_000);
        const error = await firstStartup;

        expect(error).toBeInstanceOf(ConvexRuntimeContractError);
        expect(error).toMatchObject({ reason: 'unavailable' });
        expect((error as Error).message).toMatch(/did not respond within \d+ seconds/);
        expect(stalledFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

        vi.stubGlobal('fetch', createRuntimeContractFetch());

        await expect(getWebDb()).resolves.toMatchObject({ serviceName: 'web' });
    });

    it('does not adopt a client that finishes starting after the database was closed', async () => {
        stubConvexEnv();
        const firstResponse = deferred<Response>();
        const fetch = vi
            .fn<(_input: URL | RequestInfo, init?: RequestInit) => Promise<Response>>()
            .mockImplementationOnce(() => firstResponse.promise)
            .mockImplementation(() => Promise.resolve(createRuntimeContractResponse()));
        vi.stubGlobal('fetch', fetch);

        const firstStartup = getWebDb().then(
            (client) => ({ client }),
            (error: unknown) => ({ error })
        );
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

        await closeWebDb();
        const replacement = getWebDb();
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        firstResponse.resolve(createRuntimeContractResponse());

        const firstOutcome = await firstStartup;
        const replacementClient = await replacement;

        expect(firstOutcome).toHaveProperty('error');
        expect(firstOutcome).not.toHaveProperty('client');
        await expect(getWebDb()).resolves.toBe(replacementClient);
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
    vi.stubGlobal('fetch', createRuntimeContractFetch());
}

function createRuntimeContractFetch() {
    return vi.fn(() => Promise.resolve(createRuntimeContractResponse()));
}

function createRuntimeContractResponse(): Response {
    return new Response(
        JSON.stringify({
            status: 'success',
            value: {
                blueprintRunProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            },
        })
    );
}

function createStalledFetch() {
    return vi.fn(
        (_input: URL | RequestInfo, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                if (!signal) {
                    reject(new Error('Expected the runtime-contract request to be abortable.'));
                    return;
                }

                const rejectAbort = () => reject(signal.reason);
                if (signal.aborted) rejectAbort();
                else signal.addEventListener('abort', rejectAbort, { once: true });
            })
    );
}

function createPrivateKeyPem(): string {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}
