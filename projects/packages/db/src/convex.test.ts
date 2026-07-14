import { generateKeyPairSync } from 'node:crypto';

import { api } from '@neonflux/convex-api';
import { verifyNeonFluxJwt } from '@neonflux/convex/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    CONVEX_SERVICE_AUTH_SIGNING_RETRY_DELAY_MS,
    ConvexServiceAuthTokenRefreshError,
    createConvexServiceAuthToken,
    createConvexServiceAuthTokenProvider,
    createConvexServiceDb,
    type ConvexServiceRuntimeConfig,
} from './convex.js';
import { createRuntimeDb, isConvexRuntimeDb } from './service.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from './runtime-contract.js';

describe('Convex service database', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('creates short-lived service tokens with distinct bot and web claims', async () => {
        vi.useFakeTimers();

        const config = createConfig();
        const now = new Date('2026-07-10T08:00:00.000Z');
        const issuedAt = Math.floor(now.getTime() / 1000);
        vi.setSystemTime(now);

        const [botToken, webToken] = await Promise.all([
            createConvexServiceAuthToken(config, {
                expiresInSeconds: 120,
                serviceName: 'bot',
            }),
            createConvexServiceAuthToken(config, {
                expiresInSeconds: 120,
                serviceName: 'web',
            }),
        ]);

        await expect(verifyNeonFluxJwt(createJwtSignerConfig(config), botToken)).resolves.toMatchObject({
            exp: issuedAt + 120,
            iat: issuedAt,
            neonflux: {
                kind: 'service',
                serviceName: 'bot',
            },
            sub: 'service:bot',
        });
        await expect(verifyNeonFluxJwt(createJwtSignerConfig(config), webToken)).resolves.toMatchObject({
            neonflux: {
                kind: 'service',
                serviceName: 'web',
            },
            sub: 'service:web',
        });
        expect(webToken).not.toBe(botToken);
    });

    it('uses a cached service token before the pre-expiry refresh threshold', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));

        const provider = createConvexServiceAuthTokenProvider(createConfig(), { serviceName: 'bot' });
        const firstToken = await provider();

        vi.advanceTimersByTime(8 * 60 * 1_000);

        await expect(provider()).resolves.toBe(firstToken);
    });

    it('refreshes the service token at the pre-expiry threshold', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));

        const config = createConfig();
        const provider = createConvexServiceAuthTokenProvider(config, { serviceName: 'web' });
        const firstToken = await provider();

        vi.advanceTimersByTime(9 * 60 * 1_000);

        const refreshedToken = await provider();
        const refreshedPayload = await verifyNeonFluxJwt(createJwtSignerConfig(config), refreshedToken);

        expect(refreshedToken).not.toBe(firstToken);
        expect(refreshedPayload).toMatchObject({
            iat: Date.parse('2026-07-10T08:09:00.000Z') / 1_000,
            neonflux: {
                kind: 'service',
                serviceName: 'web',
            },
        });
    });

    it('shares one signing operation across concurrent refresh requests', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));

        const provider = createConvexServiceAuthTokenProvider(createConfig(), { serviceName: 'bot' });
        await provider();
        vi.advanceTimersByTime(9 * 60 * 1_000);

        const firstRefresh = provider();
        const secondRefresh = provider();
        const thirdRefresh = provider();

        expect(secondRefresh).toBe(firstRefresh);
        expect(thirdRefresh).toBe(firstRefresh);
        await expect(Promise.all([firstRefresh, secondRefresh, thirdRefresh])).resolves.toHaveLength(3);
    });

    it('bounds signing failures without leaking key material and recovers after the retry delay', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));

        const config = createConfig();
        const validPrivateKey = config.authJwtPrivateKey;
        const invalidPrivateKey = 'TOP-SECRET-INVALID-PRIVATE-KEY';
        config.authJwtPrivateKey = invalidPrivateKey;

        const provider = createConvexServiceAuthTokenProvider(config, { serviceName: 'web' });
        const firstAttempt = provider();
        const concurrentAttempt = provider();

        expect(concurrentAttempt).toBe(firstAttempt);

        const firstFailure = await firstAttempt.catch((error: unknown) => error);
        const concurrentFailure = await concurrentAttempt.catch((error: unknown) => error);

        expect(firstFailure).toBeInstanceOf(ConvexServiceAuthTokenRefreshError);
        expect(concurrentFailure).toBe(firstFailure);
        expect(String(firstFailure)).not.toContain(invalidPrivateKey);

        config.authJwtPrivateKey = validPrivateKey;

        const cooldownFailure = await provider().catch((error: unknown) => error);

        expect(cooldownFailure).toBe(firstFailure);

        vi.advanceTimersByTime(CONVEX_SERVICE_AUTH_SIGNING_RETRY_DELAY_MS);

        const recoveredToken = await provider();

        await expect(verifyNeonFluxJwt(createJwtSignerConfig(config), recoveredToken)).resolves.toMatchObject({
            neonflux: {
                kind: 'service',
                serviceName: 'web',
            },
        });
    });

    it('authenticates Convex requests with a renewed token after more than ten minutes', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));

        const config = createConfig();
        const authorizationTokens = stubSuccessfulConvexQueries();
        const database = await createConvexServiceDb(config, { serviceName: 'bot' });

        await database.client.query(api.core.readDeploymentConfig, {});

        const firstToken = authorizationTokens[0];

        if (!firstToken) {
            throw new Error('Expected the first authenticated Convex request.');
        }

        const firstPayload = await verifyNeonFluxJwt(createJwtSignerConfig(config), firstToken);

        vi.advanceTimersByTime(8 * 60 * 1_000);
        await database.client.query(api.core.readDeploymentConfig, {});

        expect(authorizationTokens[1]).toBe(firstToken);

        vi.advanceTimersByTime(3 * 60 * 1_000);
        await database.client.query(api.core.readDeploymentConfig, {});

        expect(authorizationTokens).toHaveLength(3);
        expect(authorizationTokens[2]).not.toBe(firstToken);

        const renewedToken = authorizationTokens[2];

        if (!renewedToken) {
            throw new Error('Expected the renewed authenticated Convex request.');
        }

        const renewedPayload = await verifyNeonFluxJwt(createJwtSignerConfig(config), renewedToken);

        expect(firstPayload).toMatchObject({
            exp: Date.parse('2026-07-10T08:10:00.000Z') / 1_000,
            neonflux: { kind: 'service', serviceName: 'bot' },
        });
        expect(renewedPayload).toMatchObject({
            iat: Date.parse('2026-07-10T08:11:00.000Z') / 1_000,
            neonflux: { kind: 'service', serviceName: 'bot' },
        });
    });

    it('selects Convex runtime without DATABASE_URL when cutover config is complete', async () => {
        stubSuccessfulConvexQueries({
            blueprintRunProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        });
        const database = await createRuntimeDb(
            {
                appEnv: 'production',
                convex: createWebRuntimeConfig(createConfig()),
                guildDefconOverride: 'auto',
                logLevel: 'info',
                nodeEnv: 'production',
            },
            { serviceName: 'web' }
        );

        expect(isConvexRuntimeDb(database)).toBe(true);
        expect(database).toMatchObject({
            serviceName: 'web',
            url: 'https://neonflux-test.convex.cloud',
        });
    });

    it('requires complete Convex config instead of falling back to Postgres', async () => {
        await expect(
            createRuntimeDb(
                {
                    appEnv: 'production',
                    convex: {},
                    guildDefconOverride: 'auto',
                    logLevel: 'info',
                    nodeEnv: 'production',
                },
                { serviceName: 'web' }
            )
        ).rejects.toThrow('Complete Convex config is required');
    });
});

function createJwtSignerConfig(config: ConvexServiceRuntimeConfig) {
    return {
        audience: config.authJwtAudience,
        issuer: config.authJwtIssuer,
        privateKeyPem: config.authJwtPrivateKey,
    };
}

function stubSuccessfulConvexQueries(
    value: Record<string, unknown> = {
        instanceMode: 'multi',
        ownerIds: [],
        publicWebUrl: null,
    }
): string[] {
    const authorizationTokens: string[] = [];
    const fetch = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get('Authorization');

        if (!authorization?.startsWith('Bearer ')) {
            return Promise.resolve(new Response('Missing bearer token', { status: 401 }));
        }

        authorizationTokens.push(authorization.slice('Bearer '.length));

        return Promise.resolve(
            new Response(
                JSON.stringify({
                    status: 'success',
                    value,
                })
            )
        );
    });

    vi.stubGlobal('fetch', fetch);

    return authorizationTokens;
}

function createConfig(): ConvexServiceRuntimeConfig {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

    return {
        authJwtAudience: 'neonflux-convex',
        authJwtIssuer: 'https://neonflux.example/auth',
        authJwtPrivateKey: privateKeyPem,
        deployment: 'team:neonflux-test',
        publicUrl: 'https://neonflux-test.convex.cloud',
        url: 'https://neonflux-test.convex.cloud',
    };
}

function createWebRuntimeConfig(config: ConvexServiceRuntimeConfig) {
    return {
        deployment: config.deployment,
        publicUrl: config.publicUrl,
        url: config.url,
        webAuthJwtAudience: config.authJwtAudience,
        webAuthJwtIssuer: config.authJwtIssuer,
        webAuthJwtPrivateKey: config.authJwtPrivateKey,
    };
}
