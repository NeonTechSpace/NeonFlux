import { describe, expect, it } from 'vitest';

import {
    buildObservedEventStateDocument,
    buildStructureExportSnapshotDocument,
    buildStructureImportActionDocument,
    buildStructureImportRunDocument,
    buildStructureImportRunStatusPatch,
    toStructureImportActionRecord,
    toStructureImportRunRecord,
    toStructureObservedEventStateRecord,
} from './structure_model.js';

const now = '2026-06-28T12:00:00.000Z';
const legacyId = () => 'legacy-1';

describe('structure model', () => {
    it('builds export snapshots with defaults and validates snapshot shape', () => {
        const snapshot = unwrap(
            buildStructureExportSnapshotDocument(
                {
                    createdByUserId: ' actor-1 ',
                    guildId: ' guild-1 ',
                    snapshot: { roles: [{ id: 'role-1' }] },
                    source: ' dashboard ',
                },
                now,
                legacyId
            )
        );
        const invalid = buildStructureExportSnapshotDocument({ guildId: 'guild-1', snapshot: [] as never }, now);

        expect(snapshot).toMatchObject({
            createdByUserId: 'actor-1',
            guildId: 'guild-1',
            legacyId: 'legacy-1',
            source: 'dashboard',
        });
        expect(invalid).toStrictEqual({ error: { field: 'snapshot', type: 'invalid-value' }, ok: false });
    });

    it('builds import runs and enforces status transitions', () => {
        const run = unwrap(
            buildStructureImportRunDocument(
                {
                    createdByUserId: 'actor-1',
                    guildId: 'guild-1',
                    plan: { summary: { creates: 1 } },
                    sourceSnapshotId: 'snapshot-1',
                },
                now,
                legacyId
            )
        );
        const dryRun = unwrap(buildStructureImportRunStatusPatch(run, { status: 'dry_run_complete' }, now));
        const confirmed = unwrap(
            buildStructureImportRunStatusPatch({ ...run, ...dryRun }, { status: 'confirmed' }, now)
        );
        const invalid = buildStructureImportRunStatusPatch(run, { status: 'applied' }, now);

        expect(toStructureImportRunRecord(run)).toMatchObject({
            confirmedAt: null,
            id: 'legacy-1',
            sourceSnapshotId: 'snapshot-1',
            status: 'draft',
        });
        expect(confirmed.confirmedAt).toBe(now);
        expect(invalid).toStrictEqual({
            error: { from: 'draft', to: 'applied', type: 'invalid-status-transition' },
            ok: false,
        });
    });

    it('builds import action records with null optional target ids', () => {
        const action = unwrap(
            buildStructureImportActionDocument(
                {
                    actionType: 'create',
                    details: { name: 'announcements' },
                    runId: 'run-1',
                    targetType: 'channel',
                },
                now,
                legacyId
            )
        );

        expect(toStructureImportActionRecord(action)).toMatchObject({
            id: 'legacy-1',
            runId: 'run-1',
            status: 'pending',
            targetId: null,
        });
    });

    it('increments observed event state and reads malformed counters as zero', () => {
        const existing = toStructureObservedEventStateRecord({
            config: { observedChangeCount: 'bad' },
            guildId: 'guild-1',
        });
        const observed = unwrap(
            buildObservedEventStateDocument(
                {
                    eventType: 'role.created',
                    guildId: 'guild-1',
                    targetId: 'role-1',
                    targetType: 'role',
                },
                existing,
                now,
                undefined,
                legacyId
            )
        );
        const record = toStructureObservedEventStateRecord(observed);

        expect(existing.observedChangeCount).toBe(0);
        expect(record).toMatchObject({
            guildId: 'guild-1',
            lastEventType: 'role.created',
            lastObservedAt: now,
            lastTargetId: 'role-1',
            lastTargetType: 'role',
            observedChangeCount: 1,
        });
    });
});

function unwrap<TValue>(result: { ok: true; value: TValue } | { error: unknown; ok: false }): TValue {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
}
