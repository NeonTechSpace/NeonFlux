import { describe, expect, it } from 'vitest';

import {
    diffBlueprintSnapshot,
    BlueprintAmbiguousIdentityError,
    type BlueprintSnapshot,
} from '@neonflux/blueprint/diff';

const role = (id: string, name = id, position = 1) => ({
    id,
    name,
    position,
    color: 0,
    permissions: '0',
    hoist: false,
    mentionable: false,
});

const channel = (id: string, name = id, url?: string) => ({
    id,
    name,
    type: 998,
    ...(url ? { url } : {}),
    parentId: null,
    position: 0,
    permissionOverwrites: [],
});

function snapshot(input: Partial<BlueprintSnapshot> = {}): BlueprintSnapshot {
    return { version: 1, guildId: 'guild', roles: [], categories: [], channels: [], ...input };
}

describe('guild structure v3 plan', () => {
    it('binds every policy fingerprint to the complete deterministic destination identity', () => {
        const current = snapshot({
            guildId: 'target-guild',
            roles: [role('z-role'), role('target-guild', '@everyone', 0), role('a-role')],
            categories: [
                {
                    id: 'm-category',
                    name: 'Category',
                    type: 4,
                    parentId: null,
                    position: 0,
                    permissionOverwrites: [],
                },
            ],
            channels: [channel('b-channel')],
        });
        const requested = snapshot({ guildId: 'source-guild' });
        const expected = {
            'a-role': 'role',
            'b-channel': 'channel',
            'm-category': 'category',
            'target-guild': 'role',
            'z-role': 'role',
        };

        for (const policy of ['merge', 'synchronize', 'rebuild'] as const) {
            const plan = diffBlueprintSnapshot(current, requested, { policy });

            expect(plan.knownTargetKinds).toStrictEqual(expected);
            expect(plan.fingerprintInput.knownTargetKinds).toStrictEqual(expected);
        }
    });

    it('classifies unmatched live objects according to an explicit policy', () => {
        const current = snapshot({ roles: [role('kept'), role('extra')] });
        const requested = snapshot({ roles: [role('kept')] });

        const merge = diffBlueprintSnapshot(current, requested, { policy: 'merge' });
        const synchronize = diffBlueprintSnapshot(current, requested, { policy: 'synchronize' });
        const rebuild = diffBlueprintSnapshot(current, requested, { policy: 'rebuild' });

        expect(merge.decisions).toContainEqual({
            targetType: 'role',
            classification: 'unmanaged-retained',
            reason: 'target-unmatched-retain',
            targetId: 'extra',
        });
        expect(synchronize.decisions).toContainEqual({
            targetType: 'role',
            classification: 'delete',
            reason: 'target-unmatched-delete',
            targetId: 'extra',
        });
        expect(rebuild.decisions.map((decision) => decision.classification)).toContain('create');
    });

    it('persists same-ID no-op identity and is idempotent against its projection', () => {
        const requested = snapshot({ roles: [role('member')] });
        const first = diffBlueprintSnapshot(requested, requested, { policy: 'synchronize' });

        expect(first.version).toBe(3);
        expect(first.sourceTargetMap).toStrictEqual({ member: 'member' });
        expect(first.decisions).toContainEqual({
            targetType: 'role',
            classification: 'no-op',
            reason: 'matched-equal',
            sourceId: 'member',
            targetId: 'member',
        });
        expect(first.changes).toStrictEqual([]);

        const second = diffBlueprintSnapshot(first.projectedSnapshot, first.projectedSnapshot, {
            policy: 'synchronize',
        });
        expect(second.changes).toStrictEqual([]);
        expect(second.blockers).toStrictEqual([]);
    });

    it('converges a cross-server update to a zero-mutation second diff', () => {
        const current = snapshot({ roles: [role('target-member', 'Member')] });
        const requested = snapshot({
            guildId: 'source-guild',
            roles: [{ ...role('source-member', 'Member'), color: 0xff00ff, hoist: true }],
        });

        const first = diffBlueprintSnapshot(current, requested, { policy: 'synchronize' });
        expect(first.changes.some((action) => action.actionType === 'update')).toBe(true);

        const reconciled = diffBlueprintSnapshot(first.projectedSnapshot, requested, {
            policy: 'synchronize',
        });
        expect(reconciled.changes).toStrictEqual([]);
        expect(reconciled.blockers).toStrictEqual([]);
    });

    it('classifies unsupported link URL changes without emitting an update', () => {
        const current = snapshot({ channels: [channel('docs', 'docs', 'https://old.example')] });
        const requested = snapshot({ channels: [channel('docs', 'docs', 'https://new.example')] });

        const plan = diffBlueprintSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.changes).toStrictEqual([]);
        expect(plan.blockers).toStrictEqual([
            {
                code: 'unsupported-field-change',
                targetType: 'channel',
                sourceId: 'docs',
                targetId: 'docs',
                fields: ['url'],
            },
        ]);
        expect(plan.decisions[0]?.classification).toBe('blocked-unsupported');
    });

    it('returns category ambiguity evidence and accepts an explicit mapping', () => {
        const category = (id: string) => ({
            id,
            name: 'Group',
            type: 4,
            parentId: null,
            position: 0,
            permissionOverwrites: [],
        });
        const current = snapshot({ categories: [category('left'), category('right')] });
        const requested = snapshot({ categories: [category('source')] });

        let thrown: unknown;
        try {
            diffBlueprintSnapshot(current, requested, { policy: 'merge' });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(BlueprintAmbiguousIdentityError);
        expect((thrown as BlueprintAmbiguousIdentityError).decisions).toStrictEqual([
            {
                targetType: 'category',
                classification: 'blocked-ambiguous',
                reason: 'blocked-ambiguous',
                sourceId: 'source',
                candidateTargetIds: ['left', 'right'],
            },
        ]);

        const mapped = diffBlueprintSnapshot(current, requested, {
            policy: 'merge',
            categoryMappings: { source: 'right' },
        });
        expect(mapped.sourceTargetMap.source).toBe('right');
    });
});
