import { generateKeyPairSync } from 'node:crypto';

import type { RequiredConvexConfig } from '@neonflux/config/env';
import { verifyNeonFluxJwt } from '@neonflux/convex/jwt';
import { describe, expect, it } from 'vitest';

import { createConvexServiceAuthToken, createConvexServicePersistence } from './convex.js';
import { createRuntimePersistence, isConvexRuntimePersistence } from './service.js';

describe('Convex service persistence', () => {
    it('creates short-lived service tokens for the selected runtime', async () => {
        const config = createConfig();
        const now = new Date();
        const issuedAt = Math.floor(now.getTime() / 1000);
        const token = await createConvexServiceAuthToken(config, {
            expiresInSeconds: 120,
            now,
            serviceName: 'bot',
        });

        await expect(
            verifyNeonFluxJwt(
                {
                    audience: config.authJwtAudience,
                    issuer: config.authJwtIssuer,
                    privateKeyPem: config.authJwtPrivateKey,
                },
                token
            )
        ).resolves.toMatchObject({
            exp: issuedAt + 120,
            iat: issuedAt,
            neonflux: {
                kind: 'service',
                serviceName: 'bot',
            },
            sub: 'service:bot',
        });
    });

    it('creates an authenticated Convex HTTP client boundary without exposing generated paths', async () => {
        const config = createConfig();
        const persistence = await createConvexServicePersistence(config, {
            serviceName: 'web',
        });

        expect(persistence).toMatchObject({
            deployment: 'team:neonflux-test',
            serviceName: 'web',
            url: 'https://neonflux-test.convex.cloud',
        });
        expect(persistence.client).toBeDefined();
    });

    it('selects Convex runtime without DATABASE_URL when cutover config is complete', async () => {
        const persistence = await createRuntimePersistence(
            {
                appEnv: 'production',
                convex: createConfig(),
                guildDefconOverride: 'auto',
                logLevel: 'info',
                nodeEnv: 'production',
            },
            { serviceName: 'web' }
        );

        expect(isConvexRuntimePersistence(persistence)).toBe(true);
        expect(persistence).toMatchObject({
            serviceName: 'web',
            url: 'https://neonflux-test.convex.cloud',
        });
    });

    it('requires complete Convex config instead of falling back to Postgres', async () => {
        await expect(
            createRuntimePersistence(
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

function createConfig(): RequiredConvexConfig {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    return {
        authJwtAudience: 'neonflux-convex',
        authJwtIssuer: 'https://neonflux.example/auth',
        authJwtPrivateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }),
        deployKey: 'deploy-key',
        deployment: 'team:neonflux-test',
        publicUrl: 'https://neonflux-test.convex.cloud',
        url: 'https://neonflux-test.convex.cloud',
    };
}
