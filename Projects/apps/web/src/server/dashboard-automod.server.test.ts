import {
    deleteAutomodRule,
    listAutomodEventsByGuildId,
    listAutomodRulesByGuildId,
    recordBotActionEvent,
    saveAutomodRule,
} from '@neonflux/db';
import type { AutomodEventRecord, AutomodRuleRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    deleteDashboardAutomodRule,
    loadDashboardAutomodSettings,
    updateDashboardAutomodRule,
} from './dashboard-automod.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/moderation');
const authContext = {
    session: {
        id: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
        fluxerUserId: 'actor-1',
        createdAt: new Date('2026-06-21T00:00:00.000Z'),
        expiresAt: new Date('2026-06-28T00:00:00.000Z'),
        revokedAt: null,
    },
    fluxerUserId: 'actor-1',
    accessToken: 'fresh-access-token',
    scopes: ['identify', 'guilds'],
    accessTokenExpiresAt: new Date('2026-06-21T01:00:00.000Z'),
};

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('./dashboard-guild-page.server.js', () => ({
    loadDashboardGuildPageData: vi.fn(),
}));

vi.mock('./fluxer-auth-context.server.js', () => ({
    readAuthenticatedFluxerContext: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        deleteAutomodRule: vi.fn(),
        listAutomodEventsByGuildId: vi.fn(),
        listAutomodRulesByGuildId: vi.fn(),
        recordBotActionEvent: vi.fn(),
        saveAutomodRule: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('dashboard automod settings', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'guild-1',
                name: 'Guild One',
            },
        });
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(ok(authContext));
        vi.mocked(getFluxerCurrentUser).mockResolvedValue(
            ok({
                id: 'actor-1',
                username: 'neonsy',
                discriminator: '0',
                globalName: 'Neonsy',
                avatar: null,
            })
        );
        vi.mocked(listAutomodRulesByGuildId).mockResolvedValue(ok([createRuleRecord()]));
        vi.mocked(listAutomodEventsByGuildId).mockResolvedValue(ok([createEventRecord()]));
        vi.mocked(saveAutomodRule).mockResolvedValue(ok(createRuleRecord()));
        vi.mocked(deleteAutomodRule).mockResolvedValue(ok(createRuleRecord()));
        vi.mocked(recordBotActionEvent).mockResolvedValue(ok(createAuditEventRecord()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads rules and recent events through authorized guild scope', async () => {
        const result = await loadDashboardAutomodSettings(request, 'requested-guild');

        expect(result).toMatchObject({
            type: 'settings',
            rules: [
                {
                    id: 'rule-1',
                    name: 'Blocked terms',
                    triggerType: 'blocked_terms',
                    terms: ['spam'],
                },
            ],
            events: [
                {
                    id: 'event-1',
                    authorUserId: 'user-1',
                    matchedTerms: ['spam'],
                    matchedTermCount: 1,
                },
            ],
        });
        expect(listAutomodRulesByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
        expect(listAutomodEventsByGuildId).toHaveBeenCalledWith({}, { guildId: 'guild-1', limit: 25 });
    });

    it('denies unavailable guilds before writing', async () => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'auth-required' });

        const result = await updateDashboardAutomodRule(request, createUpdateInput());

        expect(result).toStrictEqual({ type: 'auth-required' });
        expect(saveAutomodRule).not.toHaveBeenCalled();
        expect(recordBotActionEvent).not.toHaveBeenCalled();
    });

    it('updates rules and records audit metadata without raw terms', async () => {
        const result = await updateDashboardAutomodRule(request, createUpdateInput());

        expect(result).toMatchObject({
            type: 'updated',
            rule: {
                id: 'rule-1',
                triggerType: 'blocked_terms',
            },
        });
        expect(saveAutomodRule).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                name: 'Blocked terms',
                triggerType: 'blocked_terms',
                actionType: 'record',
                enabled: true,
                config: {
                    terms: ['spam', 'scam'],
                    ignoredChannelIds: [],
                    ignoredRoleIds: [],
                    ignoredUserIds: [],
                },
            }
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'guild-1',
                feature: 'automod',
                action: 'rule.updated',
                actorUserId: 'actor-1',
                targetId: 'rule-1',
                metadata: expect.not.objectContaining({
                    terms: expect.anything(),
                }),
            })
        );
    });

    it('saves timeout action settings without raw terms in audit metadata', async () => {
        vi.mocked(saveAutomodRule).mockResolvedValueOnce(
            ok(
                createRuleRecord({
                    actionType: 'timeout',
                    config: { terms: ['spam', 'scam'], timeoutDurationSeconds: 600 },
                })
            )
        );

        const result = await updateDashboardAutomodRule(
            request,
            createUpdateInput({
                actionType: 'timeout',
                timeoutDurationSeconds: 600,
            })
        );

        expect(result).toMatchObject({
            type: 'updated',
            rule: {
                actionType: 'timeout',
                timeoutDurationSeconds: 600,
            },
        });
        expect(saveAutomodRule).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionType: 'timeout',
                config: {
                    terms: ['spam', 'scam'],
                    timeoutDurationSeconds: 600,
                    ignoredChannelIds: [],
                    ignoredRoleIds: [],
                    ignoredUserIds: [],
                },
            })
        );
        expect(recordBotActionEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                metadata: expect.objectContaining({
                    actionType: 'timeout',
                    termCount: 2,
                }),
            })
        );
    });

    it('saves warn actions with ignore lists', async () => {
        vi.mocked(saveAutomodRule).mockResolvedValueOnce(
            ok(
                createRuleRecord({
                    actionType: 'warn',
                    config: {
                        terms: ['spam'],
                        ignoredChannelIds: ['channel-1'],
                        ignoredRoleIds: ['role-1'],
                        ignoredUserIds: ['user-1'],
                    },
                })
            )
        );

        const result = await updateDashboardAutomodRule(
            request,
            createUpdateInput({
                actionType: 'warn',
                ignoredChannelIds: ['channel-1'],
                ignoredRoleIds: ['role-1'],
                ignoredUserIds: ['user-1'],
            })
        );

        expect(result).toMatchObject({
            type: 'updated',
            rule: {
                actionType: 'warn',
                ignoredChannelIds: ['channel-1'],
                ignoredRoleIds: ['role-1'],
                ignoredUserIds: ['user-1'],
            },
        });
        expect(saveAutomodRule).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                actionType: 'warn',
                config: {
                    terms: ['spam', 'scam'],
                    ignoredChannelIds: ['channel-1'],
                    ignoredRoleIds: ['role-1'],
                    ignoredUserIds: ['user-1'],
                },
            })
        );
    });

    it('maps repository validation and deletes guild-scoped rules', async () => {
        vi.mocked(saveAutomodRule).mockResolvedValueOnce(err({ type: 'invalid-value', field: 'config.terms' }));

        const invalid = await updateDashboardAutomodRule(request, createUpdateInput({ terms: [] }));
        const deleted = await deleteDashboardAutomodRule(request, { guildId: 'guild-1', ruleId: 'rule-1' });

        expect(invalid).toStrictEqual({ type: 'invalid-input', field: 'config.terms' });
        expect(deleted).toMatchObject({ type: 'deleted', rule: { id: 'rule-1' } });
        expect(deleteAutomodRule).toHaveBeenCalledWith({}, { guildId: 'guild-1', ruleId: 'rule-1' });
    });
});

function createUpdateInput(overrides: Partial<Parameters<typeof updateDashboardAutomodRule>[1]> = {}) {
    return {
        guildId: 'guild-1',
        name: 'Blocked terms',
        triggerType: 'blocked_terms' as const,
        enabled: true,
        terms: ['spam', 'scam'],
        ...overrides,
    };
}

function createRuleRecord(overrides: Partial<AutomodRuleRecord> = {}): AutomodRuleRecord {
    return {
        id: 'rule-1',
        guildId: 'guild-1',
        name: 'Blocked terms',
        triggerType: 'blocked_terms',
        actionType: 'record',
        enabled: true,
        config: { terms: ['spam'] },
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
        updatedAt: new Date('2026-06-28T00:00:00.000Z'),
        ...overrides,
    };
}

function createEventRecord(overrides: Partial<AutomodEventRecord> = {}): AutomodEventRecord {
    return {
        id: 'event-1',
        guildId: 'guild-1',
        ruleId: 'rule-1',
        messageId: 'message-1',
        channelId: 'channel-1',
        authorUserId: 'user-1',
        triggerType: 'blocked_terms',
        actionType: 'record',
        status: 'recorded',
        details: {
            matchedTerms: ['spam'],
            matchedTermCount: 1,
        },
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
        ...overrides,
    };
}

function createAuditEventRecord() {
    return {
        id: 'audit-event-1',
        guildId: 'guild-1',
        feature: 'automod',
        action: 'rule.updated',
        actorUserId: 'actor-1',
        targetId: 'rule-1',
        metadata: {
            source: 'dashboard',
        },
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
    };
}
