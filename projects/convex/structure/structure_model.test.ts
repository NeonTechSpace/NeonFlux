import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

import {
    buildBackupSortCursor,
    buildObservedEventStateDocument,
    buildStructureBackupDocument,
    buildStructureBackupLeaseClaimPatch,
    buildStructureBackupLeaseClearPatch,
    buildStructureBackupSettingsPatch,
    buildStructureImportActionDocument,
    buildStructureImportRunDocument,
    buildStructureImportRunStatusPatch,
    toStructureBackupRecord,
    toStructureImportActionRecord,
    toStructureImportRunRecord,
    toStructureObservedEventStateRecord,
} from './structure_model.js';

const now = '2026-06-28T12:00:00.000Z';
const backupId = 'backup-1' as GenericId<'structureBackups'>;
const runId = 'run-1' as GenericId<'structureImportRuns'>;
const actionId = 'action-1' as GenericId<'structureImportActions'>;

describe('structure model', () => {
    it('builds backups with defaults and validates structure shape', () => {
        const backup = unwrap(
            buildStructureBackupDocument(
                {
                    createdByUserId: ' actor-1 ',
                    guildId: ' guild-1 ',
                    structure: { roles: [{ id: 'role-1' }] },
                    source: ' manual ',
                },
                now
            )
        );
        const invalid = buildStructureBackupDocument({ guildId: 'guild-1', structure: [] as never }, now);

        expect(backup).toMatchObject({
            createdByUserId: 'actor-1',
            guildId: 'guild-1',
            source: 'manual',
            status: 'succeeded',
        });
        expect(toStructureBackupRecord({ ...backup, _id: backupId }).id).toBe(backupId);
        expect(invalid).toStrictEqual({ error: { field: 'structure', type: 'invalid-value' }, ok: false });
    });

    it('builds stable backup sort cursors for backups created at the same time', () => {
        const first = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    sortKey: buildBackupSortCursor({ createdAt: now, id: 'backup-1' }),
                    structure: { roles: [] },
                },
                now
            )
        );
        const second = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    sortKey: buildBackupSortCursor({ createdAt: now, id: 'backup-2' }),
                    structure: { roles: [] },
                },
                now
            )
        );

        expect(first.sortKey).toBe('2026-06-28T12:00:00.000Z|backup-1');
        expect(second.sortKey).toBe('2026-06-28T12:00:00.000Z|backup-2');
        expect([second, first].sort((left, right) => right.sortKey.localeCompare(left.sortKey))).toStrictEqual([
            second,
            first,
        ]);
    });

    it('builds import runs and enforces status transitions', () => {
        const run = unwrap(
            buildStructureImportRunDocument(
                {
                    createdByUserId: 'actor-1',
                    guildId: 'guild-1',
                    plan: { summary: { creates: 1 } },
                    sourceBackupId: 'backup-1',
                },
                now
            )
        );
        const dryRun = unwrap(buildStructureImportRunStatusPatch(run, { status: 'dry_run_complete' }, now));
        const confirmed = unwrap(
            buildStructureImportRunStatusPatch({ ...run, ...dryRun }, { status: 'confirmed' }, now)
        );
        const invalid = buildStructureImportRunStatusPatch(run, { status: 'applied' }, now);

        expect(toStructureImportRunRecord({ ...run, _id: runId })).toMatchObject({
            confirmedAt: null,
            id: runId,
            sourceBackupId: backupId,
            status: 'draft',
        });
        expect(confirmed.confirmedAt).toBe(now);
        expect(invalid).toStrictEqual({
            error: { from: 'draft', to: 'applied', type: 'invalid-status-transition' },
            ok: false,
        });
    });

    it('recalculates next automatic backup time when cadence changes', () => {
        const patch = unwrap(
            buildStructureBackupSettingsPatch(
                {
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-07-05T12:00:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    cadenceWeeks: 4,
                    enabled: true,
                    guildId: 'guild-1',
                },
                now
            )
        );

        expect(patch).toMatchObject({
            cadenceWeeks: 4,
            enabled: true,
            nextBackupAt: '2026-07-26T12:00:00.000Z',
        });
    });

    it('clears next automatic backup time when automatic backups are disabled', () => {
        const patch = unwrap(
            buildStructureBackupSettingsPatch(
                {
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-07-05T12:00:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    cadenceWeeks: 1,
                    enabled: false,
                    guildId: 'guild-1',
                },
                now
            )
        );

        expect(patch).toMatchObject({
            cadenceWeeks: 1,
            enabled: false,
            nextBackupAt: undefined,
        });
    });

    it('claims only due automatic backup settings without an active lease', () => {
        const patch = unwrap(
            buildStructureBackupLeaseClaimPatch(
                {
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-06-28T11:59:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    leaseExpiresAt: '2026-06-28T12:30:00.000Z',
                    leaseId: 'lease-1',
                    leaseOwner: 'bot-1',
                },
                now
            )
        );
        const activeLease = unwrap(
            buildStructureBackupLeaseClaimPatch(
                {
                    backupLeaseExpiresAt: '2026-06-28T12:10:00.000Z',
                    backupLeaseId: 'lease-active',
                    backupLeaseOwner: 'bot-active',
                    backupLeaseStartedAt: '2026-06-28T11:50:00.000Z',
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-06-28T11:59:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    leaseExpiresAt: '2026-06-28T12:30:00.000Z',
                    leaseId: 'lease-2',
                    leaseOwner: 'bot-2',
                },
                now
            )
        );

        expect(patch).toMatchObject({
            backupLeaseExpiresAt: '2026-06-28T12:30:00.000Z',
            backupLeaseId: 'lease-1',
            backupLeaseOwner: 'bot-1',
            backupLeaseStartedAt: now,
        });
        expect(activeLease).toBeNull();
    });

    it('clears only the matching automatic backup lease', () => {
        const existing = {
            backupLeaseExpiresAt: '2026-06-28T12:30:00.000Z',
            backupLeaseId: 'lease-1',
            backupLeaseOwner: 'bot-1',
            backupLeaseStartedAt: '2026-06-28T12:00:00.000Z',
            cadenceWeeks: 1,
            createdAt: now,
            enabled: true,
            guildId: 'guild-1',
            nextBackupAt: '2026-06-28T11:59:00.000Z',
            retentionDays: 180,
            updatedAt: now,
        };
        const patch = unwrap(buildStructureBackupLeaseClearPatch(existing, { leaseId: 'lease-1' }, now));
        const mismatch = unwrap(buildStructureBackupLeaseClearPatch(existing, { leaseId: 'lease-2' }, now));

        expect(patch).toStrictEqual({
            backupLeaseExpiresAt: undefined,
            backupLeaseId: undefined,
            backupLeaseOwner: undefined,
            backupLeaseStartedAt: undefined,
            updatedAt: now,
        });
        expect(mismatch).toBeNull();
    });

    it('builds import action records with null optional target ids', () => {
        const action = unwrap(
            buildStructureImportActionDocument(
                {
                    actionType: 'create',
                    details: { name: 'announcements' },
                    runId: 'run-1',
                    sequence: 0,
                    targetType: 'channel',
                },
                now
            )
        );

        expect(toStructureImportActionRecord({ ...action, _id: actionId })).toMatchObject({
            id: actionId,
            runId,
            status: 'pending',
            targetId: null,
        });
    });

    it('rejects import action records without an explicit sequence', () => {
        const invalid = buildStructureImportActionDocument(
            {
                actionType: 'create',
                details: { name: 'announcements' },
                runId: 'run-1',
                targetType: 'channel',
            },
            now
        );

        expect(invalid).toStrictEqual({
            error: { field: 'sequence', type: 'invalid-value' },
            ok: false,
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
                now
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
            targetChangeCounts: { role: 1 },
        });
    });
});

function unwrap<TValue>(result: { ok: true; value: TValue } | { error: unknown; ok: false }): TValue {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
}
