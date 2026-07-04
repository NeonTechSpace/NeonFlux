import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    cleanupDeletedGuildRoleReferences,
    createRoleReconciliationRun,
    findRoleReconciliationSettingsByGuildId,
    recordRoleReconciliationAction,
    updateRoleReconciliationRunStatus,
    upsertRoleReconciliationSettings,
} from './runtime-role-reconciliation.js';

const settings = {
    cleanupDeletedRoleReferences: true,
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    guildId: 'guild-1',
    restoreAutoroleRoles: true,
    restoreReactionRoles: false,
    restoreVerificationRoles: true,
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const run = {
    createdAt: '2026-07-03T09:00:00.000Z',
    guildId: 'guild-1',
    id: 'run-1',
    status: 'pending',
    summary: { missingRoleCount: 2 },
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const action = {
    actionType: 'member.role_restored',
    createdAt: '2026-07-03T09:01:00.000Z',
    details: { userId: 'user-1' },
    id: 'action-1',
    roleId: 'role-1',
    runId: 'run-1',
    status: 'applied',
    updatedAt: '2026-07-03T09:01:00.000Z',
};
const cleanupResult = {
    runId: 'run-2',
    status: 'cleaned' as const,
    summary: {
        autoroleRulesDisabled: 1,
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
};

describe('Convex role reconciliation database functions', () => {
    it('reads and upserts settings through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [settings],
            queryResults: [settings],
        });

        const read = await findRoleReconciliationSettingsByGuildId(db, { guildId: ' guild-1 ' });
        const saved = await upsertRoleReconciliationSettings(db, {
            cleanupDeletedRoleReferences: true,
            enabled: true,
            guildId: ' guild-1 ',
            restoreAutoroleRoles: true,
            restoreReactionRoles: false,
            restoreVerificationRoles: true,
        });

        expect(read._unsafeUnwrap()).toStrictEqual(toSettingsRecord(settings));
        expect(saved._unsafeUnwrap()).toStrictEqual(toSettingsRecord(settings));
        expect(db.client.queryCalls[0]?.args).toStrictEqual({ guildId: 'guild-1' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            cleanupDeletedRoleReferences: true,
            enabled: true,
            guildId: 'guild-1',
            restoreAutoroleRoles: true,
            restoreReactionRoles: false,
            restoreVerificationRoles: true,
        });
    });

    it('creates runs, updates run status, and records actions through Convex', async () => {
        const updatedRun = { ...run, status: 'applied', summary: { appliedRoleIds: ['role-1'] } };
        const db = createConvexDb({
            mutationResults: [run, updatedRun, action],
        });

        const created = await createRoleReconciliationRun(db, {
            guildId: ' guild-1 ',
            summary: { missingRoleCount: 2 },
        });
        const updated = await updateRoleReconciliationRunStatus(db, {
            runId: ' run-1 ',
            status: ' applied ',
            summary: { appliedRoleIds: ['role-1'] },
        });
        const recorded = await recordRoleReconciliationAction(db, {
            actionType: ' member.role_restored ',
            details: { userId: 'user-1' },
            roleId: ' role-1 ',
            runId: ' run-1 ',
            status: ' applied ',
        });

        expect(created._unsafeUnwrap()).toStrictEqual(toRunRecord(run));
        expect(updated._unsafeUnwrap()).toStrictEqual(toRunRecord(updatedRun));
        expect(recorded._unsafeUnwrap()).toStrictEqual(toActionRecord(action));
        expect(db.client.mutationCalls).toMatchObject([
            { args: { guildId: 'guild-1', summary: { missingRoleCount: 2 } } },
            {
                args: {
                    runId: 'run-1',
                    status: 'applied',
                    summary: { appliedRoleIds: ['role-1'] },
                },
            },
            {
                args: {
                    actionType: 'member.role_restored',
                    details: { userId: 'user-1' },
                    roleId: 'role-1',
                    runId: 'run-1',
                    status: 'applied',
                },
            },
        ]);
    });

    it('runs deleted role cleanup through Convex with ISO timestamps', async () => {
        const db = createConvexDb({ mutationResults: [cleanupResult] });
        const occurredAt = new Date('2026-07-03T10:00:00.000Z');

        const result = await cleanupDeletedGuildRoleReferences(db, {
            guildId: ' guild-1 ',
            occurredAt,
            roleId: ' role-1 ',
        });

        expect(result._unsafeUnwrap()).toStrictEqual(cleanupResult);
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            occurredAt: '2026-07-03T10:00:00.000Z',
            roleId: 'role-1',
        });
    });

    it('maps validation failures before calling Convex', async () => {
        const db = createConvexDb({});

        const missingGuild = await findRoleReconciliationSettingsByGuildId(db, { guildId: ' ' });
        const invalidSummary = await createRoleReconciliationRun(db, {
            guildId: 'guild-1',
            summary: [] as unknown as Record<string, unknown>,
        });
        const missingAction = await recordRoleReconciliationAction(db, {
            actionType: ' ',
            runId: 'run-1',
        });

        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({
            field: 'guildId',
            type: 'missing-input',
        });
        expect(invalidSummary._unsafeUnwrapErr()).toStrictEqual({
            field: 'summary',
            type: 'invalid-value',
        });
        expect(missingAction._unsafeUnwrapErr()).toStrictEqual({
            field: 'actionType',
            type: 'missing-input',
        });
        expect(db.client.mutationCalls).toHaveLength(0);
        expect(db.client.queryCalls).toHaveLength(0);
    });

    it('maps null updates and Convex failures to repository errors', async () => {
        const missingRunDb = createConvexDb({ mutationResults: [null] });
        const failureDb = createConvexDb({ mutationErrors: [new Error('guild-not-found')] });

        const missingRun = await updateRoleReconciliationRunStatus(missingRunDb, {
            runId: 'run-1',
            status: 'applied',
        });
        const failedCreate = await createRoleReconciliationRun(failureDb, {
            guildId: 'guild-1',
        });

        expect(missingRun._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(failedCreate._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });
});

function toSettingsRecord(record: typeof settings) {
    return {
        cleanupDeletedRoleReferences: record.cleanupDeletedRoleReferences,
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        guildId: record.guildId,
        restoreAutoroleRoles: record.restoreAutoroleRoles,
        restoreReactionRoles: record.restoreReactionRoles,
        restoreVerificationRoles: record.restoreVerificationRoles,
        updatedAt: new Date(record.updatedAt),
    };
}

function toRunRecord(record: {
    createdAt: string;
    guildId: string;
    id: string;
    status: string;
    summary: Record<string, unknown>;
    updatedAt: string;
}) {
    return {
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        id: record.id,
        status: record.status,
        summary: record.summary,
        updatedAt: new Date(record.updatedAt),
    };
}

function toActionRecord(record: typeof action) {
    return {
        actionType: record.actionType,
        createdAt: new Date(record.createdAt),
        details: record.details,
        id: record.id,
        roleId: record.roleId,
        runId: record.runId,
        status: record.status,
        updatedAt: new Date(record.updatedAt),
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) throw error;

            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) throw error;

            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}
