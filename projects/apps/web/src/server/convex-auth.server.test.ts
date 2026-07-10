import { generateKeyPairSync } from 'node:crypto';

import { verifyNeonFluxJwt } from '@neonflux/convex';
import type { NeonFluxJwtSignerConfig } from '@neonflux/convex';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    handleConvexJwksRequest,
    handleConvexTokenRequest,
    loadWebConvexJwtSignerConfig,
} from './convex-auth.server.js';
import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import { readAuthenticatedWebSession } from './web-session.server.js';

vi.mock('@neonflux/config', () => ({
    loadWebConfig: vi.fn(() => ({
        appEnv: 'production',
        convex: createConvexConfig(),
        guildDefconOverride: 'auto',
        logLevel: 'info',
        nodeEnv: 'test',
    })),
}));

vi.mock('./dashboard-guild-access.server.js', () => ({
    loadDashboardGuildAccess: vi.fn(),
}));

vi.mock('./web-session.server.js', () => ({
    readAuthenticatedWebSession: vi.fn(),
}));

const jwtConfig = createJwtConfig();

beforeEach(() => {
    vi.mocked(readAuthenticatedWebSession).mockResolvedValue(
        ok({
            createdAt: new Date('2026-07-03T08:00:00.000Z'),
            expiresAt: new Date('2026-07-03T09:00:00.000Z'),
            fluxerUserId: 'user-1',
            id: 'session-1',
            revokedAt: null,
        })
    );
    vi.mocked(loadDashboardGuildAccess).mockResolvedValue(
        ok({
            guilds: [
                {
                    botInstalled: true,
                    canManage: true,
                    iconUrl: 'https://cdn.example/guild-1.png',
                    id: 'guild-1',
                    name: 'Guild One',
                    ownerId: 'user-1',
                },
            ],
            mode: { instanceMode: 'multi' },
            type: 'authorized',
        })
    );
});

describe('handleConvexJwksRequest', () => {
    it('returns public JWKS without private key material', async () => {
        const response = await handleConvexJwksRequest();
        const body = JSON.stringify(await response.json());

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
        expect(body).toContain('"kty":"RSA"');
        expect(body).not.toContain('"d"');
        expect(body).not.toContain('PRIVATE KEY');
    });
});

describe('handleConvexTokenRequest', () => {
    it('issues a short-lived user token with manageable guild claims', async () => {
        const now = new Date();
        const issuedAt = Math.floor(now.getTime() / 1000);
        const response = await handleConvexTokenRequest(new Request('https://neonflux.example/auth/convex/token'), {
            now,
        });
        const body = (await response.json()) as { expiresAt: string; token: string };
        const payload = await verifyNeonFluxJwt(jwtConfig, body.token);

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(body.expiresAt).toBe(new Date(now.getTime() + 5 * 60 * 1000).toISOString());
        expect(payload).toMatchObject({
            exp: issuedAt + 5 * 60,
            iat: issuedAt,
            neonflux: {
                fluxerUserId: 'user-1',
                kind: 'user',
                manageableGuildIds: ['guild-1'],
                sessionId: 'session-1',
            },
            sub: 'fluxer-user:user-1',
        });
    });

    it('does not include Fluxer token material in the response body', async () => {
        const response = await handleConvexTokenRequest(new Request('https://neonflux.example/auth/convex/token'));
        const body = await response.text();

        expect(body).not.toContain('access-token');
        expect(body).not.toContain('refresh-token');
        expect(body).not.toContain('client-secret');
    });

    it('returns 401 when the existing web session is missing', async () => {
        vi.mocked(readAuthenticatedWebSession).mockResolvedValue(err('missing-cookie'));

        const response = await handleConvexTokenRequest(new Request('https://neonflux.example/auth/convex/token'));

        expect(response.status).toBe(401);
    });

    it('issues an empty guild scope for authenticated users without dashboard guilds', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValue(
            ok({
                mode: { instanceMode: 'multi' },
                type: 'no-manageable-guilds',
            })
        );

        const response = await handleConvexTokenRequest(new Request('https://neonflux.example/auth/convex/token'));
        const body = (await response.json()) as { token: string };
        const payload = await verifyNeonFluxJwt(jwtConfig, body.token);

        expect(payload.neonflux).toMatchObject({
            kind: 'user',
            manageableGuildIds: [],
        });
    });
});

describe('loadWebConvexJwtSignerConfig', () => {
    it('requires the JWT private key before issuing Convex tokens', () => {
        expect(() =>
            loadWebConvexJwtSignerConfig({
                appEnv: 'production',
                convex: {
                    userAuthJwtAudience: 'neonflux-convex-user',
                    userAuthJwtIssuer: 'https://neonflux.example/user',
                },
                guildDefconOverride: 'auto',
                logLevel: 'info',
                nodeEnv: 'test',
            })
        ).toThrow('NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY is required');
    });
});

function createConvexConfig() {
    return {
        userAuthJwtAudience: jwtConfig.audience,
        userAuthJwtIssuer: jwtConfig.issuer,
        userAuthJwtPrivateKey: jwtConfig.privateKeyPem,
    };
}

function createJwtConfig(): NeonFluxJwtSignerConfig {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    return {
        audience: 'neonflux-convex-user',
        issuer: 'https://neonflux.example/user',
        privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    };
}
