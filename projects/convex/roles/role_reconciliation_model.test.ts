import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

import {
    buildRoleReconciliationActionDocument,
    buildRoleReconciliationRunDocument,
    buildRoleReconciliationRunStatusPatch,
    buildRoleReconciliationSettingsDocument,
    defaultRoleReconciliationSettingsRecord,
    toRoleReconciliationActionRecord,
    toRoleReconciliationRunRecord,
    toRoleReconciliationSettingsRecord,
} from './role_reconciliation_model.js';

const now = '2026-07-03T08:00:00.000Z';
const runId = 'run-1' as GenericId<'roleReconciliationRuns'>;
const actionId = 'action-1' as GenericId<'roleReconciliationActions'>;

describe('role reconciliation model', () => {
    it('builds default enabled settings and preserves timestamps on update', () => {
        const result = buildRoleReconciliationSettingsDocument(
            {
                cleanupDeletedRoleReferences: false,
                enabled: false,
                guildId: ' guild-1 ',
                restoreAutoroleRoles: true,
                restoreReactionRoles: false,
                restoreVerificationRoles: true,
            },
            now,
            {
                createdAt: '2026-07-02T08:00:00.000Z',
            }
        );

        expect(defaultRoleReconciliationSettingsRecord('guild-1')).toStrictEqual({
            cleanupDeletedRoleReferences: true,
            enabled: true,
            guildId: 'guild-1',
            restoreAutoroleRoles: true,
            restoreReactionRoles: true,
            restoreVerificationRoles: true,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toRoleReconciliationSettingsRecord(result.value)).toStrictEqual({
            cleanupDeletedRoleReferences: false,
            createdAt: '2026-07-02T08:00:00.000Z',
            enabled: false,
            guildId: 'guild-1',
            restoreAutoroleRoles: true,
            restoreReactionRoles: false,
            restoreVerificationRoles: true,
            updatedAt: now,
        });
    });

    it('builds role reconciliation runs with app-facing Convex IDs', () => {
        const result = buildRoleReconciliationRunDocument(
            {
                guildId: ' guild-1 ',
                summary: { userId: 'user-1' },
            },
            now
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toRoleReconciliationRunRecord({ ...result.value, _id: runId })).toStrictEqual({
            createdAt: now,
            guildId: 'guild-1',
            id: runId,
            status: 'pending',
            summary: { userId: 'user-1' },
            updatedAt: now,
        });
    });

    it('preserves run summaries unless status update supplies a replacement', () => {
        const applying = buildRoleReconciliationRunStatusPatch(
            {
                status: 'pending',
                summary: { userId: 'user-1' },
            },
            { status: 'applying' },
            now
        );
        const applied = buildRoleReconciliationRunStatusPatch(
            {
                status: 'applying',
                summary: { userId: 'user-1' },
            },
            {
                status: 'applied',
                summary: { appliedRoleIds: ['role-1'], userId: 'user-1' },
            },
            now
        );

        expect(applying).toStrictEqual({
            ok: true,
            value: {
                status: 'applying',
                summary: { userId: 'user-1' },
                updatedAt: now,
            },
        });
        expect(applied).toStrictEqual({
            ok: true,
            value: {
                status: 'applied',
                summary: { appliedRoleIds: ['role-1'], userId: 'user-1' },
                updatedAt: now,
            },
        });
    });

    it('rejects invalid run transitions and invalid JSON roots', () => {
        expect(
            buildRoleReconciliationRunStatusPatch(
                {
                    status: 'pending',
                    summary: {},
                },
                { status: 'applied' },
                now
            )
        ).toStrictEqual({
            error: {
                from: 'pending',
                to: 'applied',
                type: 'invalid-status-transition',
            },
            ok: false,
        });
        expect(
            buildRoleReconciliationRunDocument(
                {
                    guildId: 'guild-1',
                    summary: [] as unknown as Record<string, unknown>,
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'summary', type: 'invalid-value' },
            ok: false,
        });
    });

    it('builds role reconciliation actions with defaults and nullable role records', () => {
        const result = buildRoleReconciliationActionDocument(
            {
                actionType: ' member.role_restored ',
                details: { sources: ['autorole'] },
                roleId: ' role-1 ',
                runId: ' run-1 ',
                status: ' applied ',
            },
            now
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toRoleReconciliationActionRecord({ ...result.value, _id: actionId })).toStrictEqual({
            actionType: 'member.role_restored',
            createdAt: now,
            details: { sources: ['autorole'] },
            id: actionId,
            roleId: 'role-1',
            runId,
            status: 'applied',
            updatedAt: now,
        });
        const { roleId, ...actionWithoutRole } = result.value;
        expect(roleId).toBe('role-1');

        expect(toRoleReconciliationActionRecord({ ...actionWithoutRole, _id: actionId }).roleId).toBeNull();
    });

    it('rejects blank action types', () => {
        expect(
            buildRoleReconciliationActionDocument(
                {
                    actionType: ' ',
                    runId: 'run-1',
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'actionType', type: 'missing-input' },
            ok: false,
        });
    });
});
