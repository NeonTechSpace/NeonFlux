import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    readNeonFluxIdentity,
    requireActiveGuildAccess,
    requireActiveNeonFluxUser,
    requireGuildAccess,
    requireNeonFluxService,
    requireNeonFluxPostingDelegation,
    requireNeonFluxUser,
    type NeonFluxAuthContext,
} from './auth.js';
import type { QueryCtx } from './_generated/server.js';

describe('Convex NeonFlux auth helpers', () => {
    beforeEach(() => {
        vi.stubEnv('NEONFLUX_BOT_AUTH_JWT_ISSUER', 'https://neonflux.example/bot');
        vi.stubEnv('NEONFLUX_WEB_AUTH_JWT_ISSUER', 'https://neonflux.example/web');
        vi.stubEnv('NEONFLUX_USER_AUTH_JWT_ISSUER', 'https://neonflux.example/user');
    });

    afterEach(() => vi.unstubAllEnvs());
    it('returns null when Convex has no authenticated identity', async () => {
        await expect(readNeonFluxIdentity(createContext(null))).resolves.toBeNull();
    });

    it('reads flattened custom JWT user claims from Convex identity', async () => {
        await expect(
            readNeonFluxIdentity(
                createContext(
                    {
                        'neonflux.fluxerUserId': 'user-1',
                        'neonflux.kind': 'user',
                        'neonflux.manageableGuildIds': ['guild-1', 'guild-2'],
                        'neonflux.sessionId': 'session-1',
                    },
                    'https://neonflux.example/user'
                )
            )
        ).resolves.toEqual({
            fluxerUserId: 'user-1',
            kind: 'user',
            manageableGuildIds: ['guild-1', 'guild-2'],
            sessionId: 'session-1',
            subject: 'subject-1',
            tokenIdentifier: 'token-1',
        });
    });

    it('reads nested custom JWT service claims when available', async () => {
        await expect(
            requireNeonFluxService(
                createContext(
                    {
                        neonflux: {
                            kind: 'service',
                            serviceName: 'bot',
                        },
                    },
                    'https://neonflux.example/bot'
                ),
                ['bot']
            )
        ).resolves.toMatchObject({
            kind: 'service',
            serviceName: 'bot',
        });
    });

    it('rejects service tokens from user-only helpers', async () => {
        await expect(
            requireNeonFluxUser(
                createContext(
                    {
                        'neonflux.kind': 'service',
                        'neonflux.serviceName': 'bot',
                    },
                    'https://neonflux.example/bot'
                )
            )
        ).rejects.toThrow('NeonFlux user authentication required');
    });

    it('rejects user tokens from service-only helpers', async () => {
        await expect(
            requireNeonFluxService(
                createContext(
                    {
                        'neonflux.fluxerUserId': 'user-1',
                        'neonflux.kind': 'user',
                        'neonflux.sessionId': 'session-1',
                    },
                    'https://neonflux.example/user'
                ),
                ['bot']
            )
        ).rejects.toThrow('NeonFlux service authentication required');
    });

    it('rejects retired migration service tokens', async () => {
        await expect(
            requireNeonFluxService(
                createContext(
                    {
                        'neonflux.kind': 'service',
                        'neonflux.serviceName': 'migration',
                    },
                    'https://neonflux.example/bot'
                ),
                ['bot', 'web']
            )
        ).rejects.toThrow('NeonFlux service authentication required');
    });

    it('enforces guild access through manageable guild claims', async () => {
        await expect(
            requireGuildAccess(
                createContext(
                    {
                        'neonflux.fluxerUserId': 'user-1',
                        'neonflux.kind': 'user',
                        'neonflux.manageableGuildIds': ['guild-1'],
                        'neonflux.sessionId': 'session-1',
                    },
                    'https://neonflux.example/user'
                ),
                'guild-2'
            )
        ).rejects.toThrow('NeonFlux guild access required');
    });

    it('rejects revoked sessions even while their bearer is unexpired', async () => {
        const claims = {
            'neonflux.fluxerUserId': 'user-1',
            'neonflux.kind': 'user',
            'neonflux.manageableGuildIds': ['guild-1'],
            'neonflux.sessionId': 'session-1',
        };
        const session = {
            expiresAt: '2099-01-01T00:00:00.000Z',
            fluxerUserId: 'user-1',
            id: 'session-1',
            revokedAt: '2026-07-29T12:00:00.000Z',
        };

        await expect(requireActiveNeonFluxUser(createQueryContext(claims, session))).rejects.toThrow(
            'Active NeonFlux session required'
        );
    });

    it('requires both an active matching session and the bearer guild grant', async () => {
        const claims = {
            'neonflux.fluxerUserId': 'user-1',
            'neonflux.kind': 'user',
            'neonflux.manageableGuildIds': ['guild-1'],
            'neonflux.sessionId': 'session-1',
        };
        const session = {
            expiresAt: '2099-01-01T00:00:00.000Z',
            fluxerUserId: 'user-1',
            id: 'session-1',
        };

        await expect(requireActiveGuildAccess(createQueryContext(claims, session), 'guild-1')).resolves.toMatchObject({
            fluxerUserId: 'user-1',
        });
        await expect(requireActiveGuildAccess(createQueryContext(claims, session), 'guild-2')).rejects.toThrow(
            'NeonFlux guild access required'
        );
    });

    it('rejects a bot service claim signed by the web provider', async () => {
        await expect(
            requireNeonFluxService(
                createContext({ neonflux: { kind: 'service', serviceName: 'bot' } }, 'https://neonflux.example/web'),
                ['bot']
            )
        ).rejects.toThrow('NeonFlux service authentication required');
    });

    it('accepts posting delegations only from the user auth issuer', async () => {
        const claims = {
            'neonflux.actorUserId': 'user-1',
            'neonflux.guildId': 'guild-1',
            'neonflux.kind': 'posting-delegation',
            'neonflux.payloadHash': 'payload-hash',
            'neonflux.requestKey': 'request-1',
            'neonflux.requestedChannelId': 'channel-1',
        };

        await expect(requireNeonFluxPostingDelegation(createContext(claims))).resolves.toMatchObject({
            actorUserId: 'user-1',
            guildId: 'guild-1',
            kind: 'posting-delegation',
            payloadHash: 'payload-hash',
        });
        await expect(
            requireNeonFluxPostingDelegation(createContext(claims, 'https://neonflux.example/web'))
        ).rejects.toThrow('NeonFlux posting delegation required');
    });

    it('rejects broad service tokens as posting delegations', async () => {
        await expect(
            requireNeonFluxPostingDelegation(
                createContext(
                    {
                        'neonflux.kind': 'service',
                        'neonflux.serviceName': 'web',
                    },
                    'https://neonflux.example/web'
                )
            )
        ).rejects.toThrow('NeonFlux posting delegation required');
    });
});

function createContext(
    claims: Record<string, unknown> | null,
    issuer = 'https://neonflux.example/user'
): NeonFluxAuthContext {
    return {
        auth: {
            getUserIdentity: () => {
                if (!claims) {
                    return Promise.resolve(null);
                }

                return Promise.resolve({
                    issuer,
                    subject: 'subject-1',
                    tokenIdentifier: 'token-1',
                    ...claims,
                });
            },
        },
    };
}

function createQueryContext(
    claims: Record<string, unknown>,
    session: {
        expiresAt: string;
        fluxerUserId: string;
        id: string;
        revokedAt?: string;
    }
): QueryCtx {
    return {
        ...createContext(claims),
        db: {
            query: () => ({
                withIndex: () => ({
                    unique: () => Promise.resolve(session),
                }),
            }),
        },
    } as unknown as QueryCtx;
}
