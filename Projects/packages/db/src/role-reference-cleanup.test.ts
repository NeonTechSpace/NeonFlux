import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertAutoroleRule } from './autorole.js';
import { findGuildCommandPermissionRule, upsertGuildCommandPermissionRule } from './guild-command-permission-rules.js';
import { upsertGuildDashboardPermissionRule } from './guild-dashboard-permission-rules.js';
import { upsertGuild } from './guilds.js';
import { findGuildModerationPolicyByGuildId, upsertGuildModerationPolicy } from './moderation-policy.js';
import {
    listActiveReactionRoleAssignmentsByGuildUser,
    listReactionRoleMessagesByGuildId,
    upsertReactionRoleAssignment,
    upsertReactionRoleMessage,
    upsertReactionRoleOptionByMessage,
} from './reaction-roles.js';
import { cleanupDeletedGuildRoleReferences } from './role-reference-cleanup.js';
import * as schema from './schema.js';
import { createTicketPanel, listTicketPanelsByGuildId } from './tickets.js';
import { listVerificationFlowsByGuildId, upsertVerificationFlow } from './verification.js';
import { upsertXpRoleReward } from './xp.js';

const occurredAt = new Date('2026-06-27T12:00:00.000Z');

let testDatabase: TestDatabase | undefined;

beforeAll(async () => {
    testDatabase = await createTestDatabase();
});

beforeEach(async () => {
    await resetTestDatabase();
});

afterAll(async () => {
    await testDatabase?.close();
    testDatabase = undefined;
});

describe('deleted guild role reference cleanup', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    it('cleans live deleted-role config without erasing history or unrelated guild data', async () => {
        await seedRoleBackedConfig();

        const result = await expectOk(
            cleanupDeletedGuildRoleReferences(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-delete',
                occurredAt,
            })
        );

        expect(result.status).toBe('cleaned');
        expect(result.summary).toStrictEqual({
            autoroleRulesDisabled: 1,
            commandPermissionRulesUpdated: 1,
            dashboardPermissionRulesUpdated: 1,
            moderationPoliciesUpdated: 1,
            reactionRoleAssignmentsRemoved: 1,
            reactionRoleOptionsDeleted: 1,
            ticketPanelsDisabled: 1,
            ticketPanelsUpdated: 3,
            verificationFlowsDisabled: 1,
            xpRoleRewardsDeleted: 1,
        });
        await expectCleanedRoleState(result.status === 'cleaned' ? result.runId : '');

        const second = await expectOk(
            cleanupDeletedGuildRoleReferences(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-delete',
                occurredAt,
            })
        );

        expect(second).toStrictEqual({
            status: 'unchanged',
            summary: {
                autoroleRulesDisabled: 0,
                commandPermissionRulesUpdated: 0,
                dashboardPermissionRulesUpdated: 0,
                moderationPoliciesUpdated: 0,
                reactionRoleAssignmentsRemoved: 0,
                reactionRoleOptionsDeleted: 0,
                ticketPanelsDisabled: 0,
                ticketPanelsUpdated: 0,
                verificationFlowsDisabled: 0,
                xpRoleRewardsDeleted: 0,
            },
        });
    });

    it('rejects blank cleanup input before writing', async () => {
        const result = await cleanupDeletedGuildRoleReferences(getDb(), {
            guildId: 'guild-1',
            roleId: ' ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'roleId',
        });
    });
});

async function seedRoleBackedConfig(): Promise<void> {
    await expectOk(upsertAutoroleRule(getDb(), { guildId: 'guild-1', roleId: 'role-delete' }));
    await expectOk(upsertAutoroleRule(getDb(), { guildId: 'guild-1', roleId: 'role-keep' }));
    await expectOk(upsertAutoroleRule(getDb(), { guildId: 'guild-2', roleId: 'role-delete' }));

    await expectOk(
        upsertReactionRoleMessage(getDb(), { guildId: 'guild-1', channelId: 'channel-1', messageId: 'rr-1' })
    );
    await expectOk(
        upsertReactionRoleOptionByMessage(getDb(), {
            guildId: 'guild-1',
            messageId: 'rr-1',
            emojiKey: 'unicode:delete',
            roleId: 'role-delete',
        })
    );
    await expectOk(
        upsertReactionRoleOptionByMessage(getDb(), {
            guildId: 'guild-1',
            messageId: 'rr-1',
            emojiKey: 'unicode:keep',
            roleId: 'role-keep',
        })
    );
    await expectOk(
        upsertReactionRoleAssignment(getDb(), {
            guildId: 'guild-1',
            messageId: 'rr-1',
            userId: 'user-1',
            roleId: 'role-delete',
            emojiKey: 'unicode:delete',
        })
    );
    await expectOk(
        upsertReactionRoleMessage(getDb(), { guildId: 'guild-2', channelId: 'channel-2', messageId: 'rr-2' })
    );
    await expectOk(
        upsertReactionRoleOptionByMessage(getDb(), {
            guildId: 'guild-2',
            messageId: 'rr-2',
            emojiKey: 'unicode:delete',
            roleId: 'role-delete',
        })
    );

    await expectOk(
        upsertVerificationFlow(getDb(), {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'verify-1',
            emojiKey: 'unicode:check',
            verifiedRoleId: 'role-delete',
        })
    );
    await expectOk(
        upsertVerificationFlow(getDb(), {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'verify-2',
            emojiKey: 'unicode:star',
            verifiedRoleId: 'role-keep',
        })
    );
    await expectOk(
        upsertVerificationFlow(getDb(), {
            guildId: 'guild-2',
            channelId: 'channel-2',
            messageId: 'verify-3',
            emojiKey: 'unicode:check',
            verifiedRoleId: 'role-delete',
        })
    );

    await expectOk(
        upsertGuildModerationPolicy(getDb(), {
            guildId: 'guild-1',
            protectedUserIds: ['user-keep'],
            protectedRoleIds: ['role-delete', 'role-keep'],
        })
    );
    await expectOk(
        createTicketPanel(getDb(), {
            guildId: 'guild-1',
            channelId: 'tickets-1',
            title: 'Two staff roles',
            enabled: true,
            config: { privateTickets: true, staffRoleIds: ['role-delete', 'role-keep'], topic: 'keep' },
        })
    );
    await expectOk(
        createTicketPanel(getDb(), {
            guildId: 'guild-1',
            channelId: 'tickets-2',
            title: 'Only deleted private staff role',
            enabled: true,
            config: { privateTickets: true, staffRoleIds: ['role-delete'] },
        })
    );
    await expectOk(
        createTicketPanel(getDb(), {
            guildId: 'guild-1',
            channelId: 'tickets-3',
            title: 'Public panel',
            enabled: true,
            config: { privateTickets: false, staffRoleIds: ['role-delete'] },
        })
    );
    await expectOk(
        createTicketPanel(getDb(), {
            guildId: 'guild-2',
            channelId: 'tickets-4',
            title: 'Other guild',
            enabled: true,
            config: { privateTickets: true, staffRoleIds: ['role-delete'] },
        })
    );

    await expectOk(
        upsertGuildCommandPermissionRule(getDb(), {
            guildId: 'guild-1',
            targetType: 'command',
            targetId: 'moderation.ban',
            userIds: ['user-keep'],
            roleIds: ['role-delete', 'role-keep'],
        })
    );
    await expectOk(
        upsertGuildCommandPermissionRule(getDb(), {
            guildId: 'guild-2',
            targetType: 'command',
            targetId: 'moderation.ban',
            roleIds: ['role-delete'],
        })
    );
    await expectOk(
        upsertGuildDashboardPermissionRule(getDb(), {
            guildId: 'guild-1',
            userIds: ['user-keep'],
            roleIds: ['role-delete', 'role-keep'],
        })
    );
    await expectOk(
        upsertGuildDashboardPermissionRule(getDb(), {
            guildId: 'guild-2',
            roleIds: ['role-delete'],
        })
    );

    await expectOk(upsertXpRoleReward(getDb(), { guildId: 'guild-1', level: 1, roleId: 'role-delete' }));
    await expectOk(upsertXpRoleReward(getDb(), { guildId: 'guild-1', level: 2, roleId: 'role-keep' }));
    await expectOk(upsertXpRoleReward(getDb(), { guildId: 'guild-2', level: 1, roleId: 'role-delete' }));
}

async function expectCleanedRoleState(runId: string): Promise<void> {
    const autoroleRules = await getDb().select().from(schema.autoroleRules);
    expect(
        autoroleRules.map((rule) => ({
            guildId: rule.guildId,
            roleId: rule.roleId,
            enabled: rule.enabled,
        }))
    ).toEqual(
        expect.arrayContaining([
            { guildId: 'guild-1', roleId: 'role-delete', enabled: false },
            { guildId: 'guild-1', roleId: 'role-keep', enabled: true },
            { guildId: 'guild-2', roleId: 'role-delete', enabled: true },
        ])
    );

    const reactionMessages = await expectOk(listReactionRoleMessagesByGuildId(getDb(), { guildId: 'guild-1' }));
    const activeAssignments = await expectOk(
        listActiveReactionRoleAssignmentsByGuildUser(getDb(), { guildId: 'guild-1', userId: 'user-1' })
    );
    expect(reactionMessages[0]?.options.map((option) => option.roleId)).toStrictEqual(['role-keep']);
    expect(activeAssignments).toStrictEqual([]);

    const verificationFlows = await expectOk(listVerificationFlowsByGuildId(getDb(), { guildId: 'guild-1' }));
    expect(verificationFlows.map((flow) => [flow.messageId, flow.verifiedRoleId, flow.enabled])).toStrictEqual([
        ['verify-1', 'role-delete', false],
        ['verify-2', 'role-keep', true],
    ]);

    const moderationPolicy = await expectOk(findGuildModerationPolicyByGuildId(getDb(), { guildId: 'guild-1' }));
    expect(moderationPolicy).toMatchObject({
        protectedUserIds: ['user-keep'],
        protectedRoleIds: ['role-keep'],
    });

    const ticketPanels = await expectOk(listTicketPanelsByGuildId(getDb(), { guildId: 'guild-1' }));
    expect(
        ticketPanels.map((panel) => ({
            title: panel.title,
            enabled: panel.enabled,
            config: panel.config,
        }))
    ).toStrictEqual([
        {
            title: 'Two staff roles',
            enabled: true,
            config: { privateTickets: true, staffRoleIds: ['role-keep'], topic: 'keep' },
        },
        {
            title: 'Only deleted private staff role',
            enabled: false,
            config: { privateTickets: true, staffRoleIds: [] },
        },
        {
            title: 'Public panel',
            enabled: true,
            config: { privateTickets: false, staffRoleIds: [] },
        },
    ]);

    const commandRule = await expectOk(
        findGuildCommandPermissionRule(getDb(), {
            guildId: 'guild-1',
            targetType: 'command',
            targetId: 'moderation.ban',
        })
    );
    const dashboardRule = await getDb()
        .select()
        .from(schema.guildDashboardPermissionRules)
        .where(eq(schema.guildDashboardPermissionRules.guildId, 'guild-1'))
        .limit(1);
    expect(commandRule).toMatchObject({
        userIds: ['user-keep'],
        roleIds: ['role-keep'],
    });
    expect(dashboardRule[0]).toMatchObject({
        userIds: ['user-keep'],
        roleIds: ['role-keep'],
    });

    const xpRewards = await getDb().select().from(schema.xpRoleRewards);
    expect(xpRewards.map((reward) => [reward.guildId, reward.level, reward.roleId])).toStrictEqual([
        ['guild-1', 2, 'role-keep'],
        ['guild-2', 1, 'role-delete'],
    ]);

    const actionRows = await getDb()
        .select()
        .from(schema.roleReconciliationActions)
        .where(eq(schema.roleReconciliationActions.runId, runId));
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]).toMatchObject({
        actionType: 'guild.role_deleted_references_cleaned',
        roleId: 'role-delete',
        status: 'applied',
    });
}

async function expectOk<TValue>(promise: Promise<{ isOk(): boolean; _unsafeUnwrap(): TValue }>): Promise<TValue> {
    const result = await promise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): TestDatabase['db'] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('role-reference-cleanup');
}
