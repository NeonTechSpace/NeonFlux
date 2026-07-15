import { describe, expect, it } from 'vitest';

import { diffBlueprintSnapshot } from './diff.js';
import {
    normalizeBlueprintPlan,
    normalizeBlueprintPlanDecision,
    normalizeBlueprintPlanStep,
} from './runtime-contracts.js';
import { normalizeBlueprintSnapshot } from './snapshot.js';

describe('Blueprint runtime contracts', () => {
    it('accepts the canonical deterministic planner output', () => {
        const snapshotResult = normalizeBlueprintSnapshot({
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [],
        });
        if (snapshotResult.type !== 'valid') throw new Error(snapshotResult.message);
        const plan = diffBlueprintSnapshot(snapshotResult.snapshot, snapshotResult.snapshot, {
            policy: 'synchronize',
        });

        expect(normalizeBlueprintPlan(plan)).toEqual({ type: 'valid', value: plan });
    });

    it('uses plan format 4 without a persisted fingerprint-input copy', () => {
        const snapshotResult = normalizeBlueprintSnapshot({
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [],
        });
        if (snapshotResult.type !== 'valid') throw new Error(snapshotResult.message);
        const plan = diffBlueprintSnapshot(snapshotResult.snapshot, snapshotResult.snapshot, {
            policy: 'synchronize',
        });
        expect(plan.version).toBe(4);
        expect('fingerprintInput' in plan).toBe(false);
        expect(normalizeBlueprintPlan({ ...plan, version: 3 })).toMatchObject({ type: 'invalid' });
        expect(normalizeBlueprintPlan({ ...plan, fingerprintInput: {} })).toMatchObject({ type: 'invalid' });
    });

    it('rejects an ordering step disguised as a create', () => {
        expect(
            normalizeBlueprintPlanStep({
                actionType: 'create',
                targetType: 'role-order',
                targetId: 'role-order',
                label: 'Invalid order',
                details: { label: 'Invalid order' },
            })
        ).toEqual({
            type: 'invalid',
            message: 'Blueprint plan step has an unsupported actionType and targetType combination.',
        });
    });

    it('rejects a decision outside the canonical classification vocabulary', () => {
        expect(
            normalizeBlueprintPlanDecision({
                targetType: 'role',
                classification: 'maybe',
                reason: 'matched-equal',
            })
        ).toEqual({ type: 'invalid', message: 'Blueprint plan decision has an invalid classification.' });
    });

    it('accepts all eleven target-specific plan-step variants without reshaping valid data', () => {
        const role = roleSnapshot();
        const category = channelSnapshot({ id: 'category-1', type: 4 });
        const channel = channelSnapshot({ id: 'channel-1', type: 0, parentId: 'category-1' });
        const roleChange = { field: 'name', before: 'Member', after: 'Crew' } as const;
        const channelChange = { field: 'parentId', before: null, after: 'category-1' } as const;
        const roleOrder = [{ sourceId: 'role-1', position: 1, hierarchyRank: 1 }];
        const channelOrder = [{ sourceId: 'channel-1', parentSourceId: 'category-1', position: 0 }];
        const variants = [
            step('create', 'role', { after: role }),
            step('update', 'role', { changes: [roleChange], sourceId: 'source-role-1' }),
            step('delete', 'role', { before: role }),
            step('create', 'category', { after: category }),
            step('update', 'category', { changes: [channelChange] }),
            step('delete', 'category', { before: category }),
            step('create', 'channel', { after: channel }),
            step('update', 'channel', { changes: [channelChange] }),
            step('delete', 'channel', { before: channel }),
            step('update', 'role-order', {
                after: roleOrder,
                changes: [{ field: 'roleOrder', after: roleOrder }],
            }),
            step('update', 'channel-order', {
                before: [],
                after: channelOrder,
                changes: [{ field: 'channelOrder', before: [], after: channelOrder }],
            }),
        ];

        for (const variant of variants) {
            expect(normalizeBlueprintPlanStep(variant)).toEqual({ type: 'valid', value: variant });
        }
    });

    it('rejects cross-target payloads and empty updates', () => {
        expect(
            normalizeBlueprintPlanStep(step('create', 'category', { after: channelSnapshot({ type: 0 }) }))
        ).toMatchObject({ type: 'invalid' });
        expect(normalizeBlueprintPlanStep(step('update', 'role', { changes: [] }))).toMatchObject({
            type: 'invalid',
        });
        expect(
            normalizeBlueprintPlanStep(
                step('update', 'role', { changes: [{ field: 'permissionOverwrites', before: [], after: [] }] })
            )
        ).toMatchObject({ type: 'invalid' });
    });

    it('rejects malformed ordering entries and provider operations that do not match the variant', () => {
        const order = [{ sourceId: 'channel-1', parentSourceId: null, position: 0 }];
        expect(
            normalizeBlueprintPlanStep(
                step('update', 'channel-order', {
                    before: [],
                    after: [{ sourceId: 'channel-1', parentSourceId: null, position: -1 }],
                    changes: [{ field: 'channelOrder', before: [], after: order }],
                })
            )
        ).toMatchObject({ type: 'invalid' });

        expect(
            normalizeBlueprintPlanStep(
                step('create', 'role', {
                    after: roleSnapshot(),
                    provider: { groupId: 'group-1', operation: 'delete', step: 1, stepCount: 1 },
                    mutationSteps: 1,
                })
            )
        ).toEqual({
            type: 'invalid',
            message: 'Blueprint provider-step metadata does not match the plan-step variant.',
        });
    });
});

function step(actionType: string, targetType: string, details: Record<string, unknown>) {
    const targetId = targetType.endsWith('-order') ? targetType : `${targetType}-1`;
    const label = targetType;
    return { actionType, targetType, targetId, label, details: { label, ...details } };
}

function roleSnapshot() {
    return {
        id: 'role-1',
        name: 'Member',
        position: 1,
        hierarchyRank: 1,
        color: 0,
        permissions: '0',
        hoist: false,
        mentionable: false,
    };
}

function channelSnapshot(
    overrides: Partial<{
        id: string;
        type: number;
        parentId: string | null;
    }> = {}
) {
    return {
        id: overrides.id ?? 'channel-1',
        name: 'general',
        type: overrides.type ?? 0,
        parentId: overrides.parentId ?? null,
        position: 0,
        permissionOverwrites: [],
    };
}
