import type { UserIdentity } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server.js';
import { readReactionRoleExecutionPolicyHandler } from './reaction_role_policy.js';

describe('readReactionRoleExecutionPolicy', () => {
    beforeEach(() => {
        vi.stubEnv('NEONFLUX_BOT_AUTH_JWT_ISSUER', 'https://neonflux.example/bot');
        vi.stubEnv('NEONFLUX_WEB_AUTH_JWT_ISSUER', 'https://neonflux.example/web');
        vi.stubEnv('NEONFLUX_USER_AUTH_JWT_ISSUER', 'https://neonflux.example/user');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns the installation and DEFCON facts needed by the authenticated bot', async () => {
        const context = createContext(createServiceIdentity('bot'), {
            botInstallations: { guildId: 'guild-1' },
            guildSecurityPolicies: { defconLevel: 2, guildId: 'guild-1' },
        });

        await expect(
            readReactionRoleExecutionPolicyHandler(context.ctx, { guildId: ' guild-1 ' })
        ).resolves.toStrictEqual({
            botInstalled: true,
            storedDefconLevel: 2,
        });
        expect(context.lookups).toStrictEqual([
            { table: 'botInstallations', value: 'guild-1' },
            { table: 'guildSecurityPolicies', value: 'guild-1' },
        ]);
    });

    it('rejects web, user, and anonymous identities before durable reads', async () => {
        for (const identity of [createServiceIdentity('web'), createUserIdentity(), null]) {
            const context = createContext(identity, {});

            await expect(readReactionRoleExecutionPolicyHandler(context.ctx, { guildId: 'guild-1' })).rejects.toThrow(
                'NeonFlux service authentication required'
            );
            expect(context.lookups).toStrictEqual([]);
        }
    });

    it('rejects a blank guild ID before durable reads', async () => {
        const context = createContext(createServiceIdentity('bot'), {});

        await expect(readReactionRoleExecutionPolicyHandler(context.ctx, { guildId: '   ' })).rejects.toThrow(
            'missing-guild-id'
        );
        expect(context.lookups).toStrictEqual([]);
    });
});

type TableName = 'botInstallations' | 'guildSecurityPolicies';

function createContext(identity: UserIdentity | null, records: Partial<Record<TableName, unknown>>) {
    const lookups: Array<{ table: TableName; value?: string }> = [];
    const ctx = {
        auth: {
            getUserIdentity: () => Promise.resolve(identity),
        },
        db: {
            query(table: TableName) {
                return {
                    withIndex(
                        _index: string,
                        configure: (query: { eq(field: string, value: string): unknown }) => unknown
                    ) {
                        const lookup: { table: TableName; value?: string } = { table };
                        const query = {
                            eq(_field: string, value: string) {
                                lookup.value = value;
                                return query;
                            },
                        };

                        configure(query);
                        lookups.push(lookup);
                        return {
                            unique: () => Promise.resolve(records[table] ?? null),
                        };
                    },
                };
            },
        },
    } as unknown as QueryCtx;

    return { ctx, lookups };
}

function createServiceIdentity(serviceName: 'bot' | 'web'): UserIdentity {
    return {
        issuer: `https://neonflux.example/${serviceName}`,
        subject: `service:${serviceName}`,
        tokenIdentifier: `token:${serviceName}`,
        'neonflux.kind': 'service',
        'neonflux.serviceName': serviceName,
    };
}

function createUserIdentity(): UserIdentity {
    return {
        issuer: 'https://neonflux.example/user',
        subject: 'user-1',
        tokenIdentifier: 'token:user-1',
        'neonflux.fluxerUserId': 'user-1',
        'neonflux.kind': 'user',
        'neonflux.sessionId': 'session-1',
    };
}
