import {
    claimDueStructureBackupSetting,
    claimDueStructureDriftSetting,
    clearStructureBackupSettingLease,
    clearStructureDriftSettingLease,
    createStructureBackup,
    findLatestStructureDriftBaselineBackupByGuildId,
    listDueStructureBackupRetentionSettings,
    listDueStructureBackupSettings,
    listDueStructureDriftSettings,
    pruneExpiredStructureBackupsForGuild,
    recordStructureScheduledDriftResult,
    structureAuditActions,
    type RuntimeDbClient,
    structureBackupSources,
    structureBackupStatuses,
    structureScheduledDriftStatuses,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { readFluxerGuildStructure } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDueStructureBackups, startStructureBackupScheduler } from './bot-structure-backups.js';

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        claimDueStructureBackupSetting: vi.fn(),
        claimDueStructureDriftSetting: vi.fn(),
        clearStructureBackupSettingLease: vi.fn(),
        clearStructureDriftSettingLease: vi.fn(),
        createStructureBackup: vi.fn(),
        findLatestStructureDriftBaselineBackupByGuildId: vi.fn(),
        listDueStructureBackupRetentionSettings: vi.fn(),
        listDueStructureBackupSettings: vi.fn(),
        listDueStructureDriftSettings: vi.fn(),
        pruneExpiredStructureBackupsForGuild: vi.fn(),
        recordStructureScheduledDriftResult: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

    return {
        ...actual,
        readFluxerGuildStructure: vi.fn(),
    };
});

describe('runDueStructureBackups', () => {
    const client = {} as Fluxer.FluxerBot['client'];
    beforeEach(() => {
        vi.mocked(claimDueStructureBackupSetting).mockImplementation((_db, input) =>
            Promise.resolve(ok(createBackupSettings(input.guildId)))
        );
        vi.mocked(clearStructureBackupSettingLease).mockResolvedValue(ok(true));
        vi.mocked(claimDueStructureDriftSetting).mockImplementation((_db, input) =>
            Promise.resolve(ok(createBackupSettings(input.guildId)))
        );
        vi.mocked(clearStructureDriftSettingLease).mockResolvedValue(ok(true));
        vi.mocked(listDueStructureDriftSettings).mockResolvedValue(ok([]));
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId).mockResolvedValue(ok(createBaselineBackup()));
        vi.mocked(recordStructureScheduledDriftResult).mockResolvedValue(ok(createBackupSettings('guild-1')));
        vi.mocked(listDueStructureBackupRetentionSettings).mockResolvedValue(ok([]));
        vi.mocked(pruneExpiredStructureBackupsForGuild).mockResolvedValue(
            ok({ deletedCount: 0, hasMore: false, nextRetentionPruneAt: new Date('2026-07-07T00:00:00.000Z') })
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('records scheduled backup successes and read failures', async () => {
        vi.mocked(listDueStructureBackupSettings).mockResolvedValue(
            ok([createBackupSettings('guild-success'), createBackupSettings('guild-failed')])
        );
        vi.mocked(readFluxerGuildStructure)
            .mockResolvedValueOnce(ok(createFluxerStructure('guild-success', { includeBotRole: true })))
            .mockResolvedValueOnce(err({ type: 'unavailable-or-not-found' }));
        vi.mocked(createStructureBackup).mockResolvedValue(ok(createBackupRecord()));

        const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

        await runDueStructureBackups({
            client,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger,
            clock: createFixedClock(),
        });

        expect(createStructureBackup).toHaveBeenNthCalledWith(
            1,
            {},
            expect.objectContaining({
                guildId: 'guild-success',
                source: structureBackupSources.scheduled,
                status: structureBackupStatuses.succeeded,
                roleCount: 1,
                channelCount: 1,
            })
        );
        expect(claimDueStructureBackupSetting).toHaveBeenCalledTimes(2);
        expect(clearStructureBackupSettingLease).toHaveBeenCalledTimes(2);
        expect(vi.mocked(createStructureBackup).mock.calls[0]?.[1].structure).toMatchObject({
            roles: [{ id: 'role-1' }],
            channels: [{ permissionOverwrites: [] }],
        });
        expect(vi.mocked(clearStructureBackupSettingLease).mock.calls[0]?.[1]?.guildId).toBe('guild-success');
        expect(typeof vi.mocked(clearStructureBackupSettingLease).mock.calls[0]?.[1]?.leaseId).toBe('string');
        expect(createStructureBackup).toHaveBeenNthCalledWith(
            2,
            {},
            expect.objectContaining({
                guildId: 'guild-failed',
                source: structureBackupSources.scheduled,
                status: structureBackupStatuses.failed,
                errorMessage: 'Structure read failed: unavailable-or-not-found',
            })
        );
    });

    it('samples fresh time for backup discovery, claim, snapshot, and lease clear', async () => {
        vi.mocked(listDueStructureBackupSettings).mockResolvedValueOnce(ok([createBackupSettings('guild-fresh')]));
        vi.mocked(readFluxerGuildStructure).mockResolvedValueOnce(ok(createFluxerStructure('guild-fresh')));
        vi.mocked(createStructureBackup).mockResolvedValueOnce(ok(createBackupRecord()));
        const clock = createAdvancingClock(
            '2026-07-06T00:00:00.000Z',
            '2026-07-06T00:01:00.000Z',
            '2026-07-06T00:02:00.000Z',
            '2026-07-06T00:03:00.000Z',
            '2026-07-06T00:04:00.000Z',
            '2026-07-06T00:05:00.000Z'
        );

        await runDueStructureBackups({
            client,
            clock,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        });

        expect(listDueStructureBackupSettings).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ now: new Date('2026-07-06T00:02:00.000Z') })
        );
        expect(claimDueStructureBackupSetting).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                leaseExpiresAt: new Date('2026-07-06T00:33:00.000Z'),
                now: new Date('2026-07-06T00:03:00.000Z'),
            })
        );
        expect(vi.mocked(createStructureBackup).mock.calls[0]?.[1].structure).toMatchObject({
            exportedAt: '2026-07-06T00:04:00.000Z',
        });
        expect(clearStructureBackupSettingLease).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ now: new Date('2026-07-06T00:05:00.000Z') })
        );
    });

    it('drains due backup settings in batches during one run', async () => {
        vi.mocked(listDueStructureBackupSettings)
            .mockResolvedValueOnce(
                ok(Array.from({ length: 25 }, (_, index) => createBackupSettings(`guild-${String(index)}`)))
            )
            .mockResolvedValueOnce(ok([createBackupSettings('guild-25')]));
        vi.mocked(readFluxerGuildStructure).mockImplementation(({ guildId }) =>
            Promise.resolve(ok(createFluxerStructure(guildId)))
        );
        vi.mocked(createStructureBackup).mockResolvedValue(ok(createBackupRecord()));

        await runDueStructureBackups({
            client,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            clock: createFixedClock(),
        });

        expect(listDueStructureBackupSettings).toHaveBeenCalledTimes(2);
        expect(readFluxerGuildStructure).toHaveBeenCalledTimes(26);
        expect(createStructureBackup).toHaveBeenCalledTimes(26);
        expect(clearStructureBackupSettingLease).toHaveBeenCalledTimes(26);
    });

    it('skips due settings that another process already claimed', async () => {
        vi.mocked(listDueStructureBackupSettings).mockResolvedValue(ok([createBackupSettings('guild-claimed')]));
        vi.mocked(claimDueStructureBackupSetting).mockResolvedValueOnce(ok(null));

        await runDueStructureBackups({
            client,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            clock: createFixedClock(),
        });

        const claimInput = vi.mocked(claimDueStructureBackupSetting).mock.calls[0]?.[1];

        expect(claimInput).toMatchObject({
            guildId: 'guild-claimed',
            leaseExpiresAt: new Date('2026-07-06T00:30:00.000Z'),
            now: new Date('2026-07-06T00:00:00.000Z'),
        });
        expect(typeof claimInput?.leaseId).toBe('string');
        expect(typeof claimInput?.leaseOwner).toBe('string');
        expect(readFluxerGuildStructure).not.toHaveBeenCalled();
        expect(createStructureBackup).not.toHaveBeenCalled();
        expect(clearStructureBackupSettingLease).not.toHaveBeenCalled();
    });

    it('runs bounded retention cleanup before scheduled backup reads', async () => {
        const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
        const clock = createAdvancingClock(
            '2026-07-06T00:00:00.000Z',
            '2026-07-06T00:01:00.000Z',
            '2026-07-06T00:02:00.000Z',
            '2026-07-06T00:03:00.000Z'
        );
        vi.mocked(listDueStructureBackupRetentionSettings).mockResolvedValueOnce(ok([createBackupSettings('guild-1')]));
        vi.mocked(listDueStructureBackupSettings).mockResolvedValueOnce(ok([]));
        vi.mocked(pruneExpiredStructureBackupsForGuild).mockResolvedValueOnce(
            ok({ deletedCount: 100, hasMore: true, nextRetentionPruneAt: new Date('2026-07-06T00:00:00.000Z') })
        );

        await runDueStructureBackups({
            client,
            clock,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger,
        });

        expect(listDueStructureBackupRetentionSettings).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ now: new Date('2026-07-06T00:00:00.000Z') })
        );
        expect(pruneExpiredStructureBackupsForGuild).toHaveBeenCalledWith(
            {},
            {
                audit: {
                    action: structureAuditActions.backupRetentionPruned,
                    metadata: {
                        source: 'scheduled_retention',
                    },
                    targetId: 'guild-1',
                },
                guildId: 'guild-1',
                limit: 100,
                now: new Date('2026-07-06T00:01:00.000Z'),
            }
        );
        expect(logger.info).toHaveBeenCalledWith('structure.backup_retention_pruned', {
            deletedCount: 100,
            guildId: 'guild-1',
            hasMore: true,
        });
        expect(readFluxerGuildStructure).not.toHaveBeenCalled();
    });

    it('runs scheduled drift after retention and before scheduled backup reads', async () => {
        vi.mocked(listDueStructureBackupRetentionSettings).mockResolvedValueOnce(ok([createBackupSettings('guild-1')]));
        vi.mocked(listDueStructureDriftSettings).mockResolvedValueOnce(ok([]));
        vi.mocked(listDueStructureBackupSettings).mockResolvedValueOnce(ok([]));

        await runDueStructureBackups({
            client,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            clock: createFixedClock(),
        });

        expect(vi.mocked(pruneExpiredStructureBackupsForGuild).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(listDueStructureDriftSettings).mock.invocationCallOrder[0] ?? 0
        );
        expect(vi.mocked(listDueStructureDriftSettings).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(listDueStructureBackupSettings).mock.invocationCallOrder[0] ?? 0
        );
    });

    it('records changed scheduled drift with audit metadata and clears the drift lease', async () => {
        const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
        vi.mocked(listDueStructureDriftSettings).mockResolvedValueOnce(ok([createBackupSettings('guild-drift')]));
        vi.mocked(listDueStructureBackupSettings).mockResolvedValueOnce(ok([]));
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId).mockResolvedValueOnce(
            ok(createBaselineBackup({ guildId: 'guild-drift', roleName: 'Old Member' }))
        );
        vi.mocked(readFluxerGuildStructure).mockResolvedValueOnce(ok(createFluxerStructure('guild-drift')));

        await runDueStructureBackups({
            client,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger,
            clock: createFixedClock(),
        });

        const expectedDriftMetadata: unknown = expect.objectContaining({
            baselineBackupId: 'baseline-1',
            changeCount: 1,
            source: 'scheduled_drift',
        });
        expect(recordStructureScheduledDriftResult).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                audit: {
                    action: structureAuditActions.scheduledDriftDetected,
                    metadata: expectedDriftMetadata,
                    targetId: 'guild-drift',
                },
                baselineBackupId: 'baseline-1',
                changeCount: 1,
                guildId: 'guild-drift',
                status: structureScheduledDriftStatuses.changed,
            })
        );
        expect(clearStructureDriftSettingLease).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ guildId: 'guild-drift' })
        );
        expect(logger.info).toHaveBeenCalledWith('structure.scheduled_drift_detected', {
            baselineBackupId: 'baseline-1',
            changeCount: 1,
            guildId: 'guild-drift',
        });
    });

    it('samples fresh time for drift discovery, claim, snapshot result, and lease clear', async () => {
        vi.mocked(listDueStructureDriftSettings).mockResolvedValueOnce(ok([createBackupSettings('guild-drift')]));
        vi.mocked(listDueStructureBackupSettings).mockResolvedValueOnce(ok([]));
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId).mockResolvedValueOnce(
            ok(createBaselineBackup({ guildId: 'guild-drift' }))
        );
        vi.mocked(readFluxerGuildStructure).mockResolvedValueOnce(ok(createFluxerStructure('guild-drift')));
        const clock = createAdvancingClock(
            '2026-07-06T00:00:00.000Z',
            '2026-07-06T00:01:00.000Z',
            '2026-07-06T00:02:00.000Z',
            '2026-07-06T00:03:00.000Z',
            '2026-07-06T00:04:00.000Z',
            '2026-07-06T00:05:00.000Z',
            '2026-07-06T00:06:00.000Z'
        );

        await runDueStructureBackups({
            client,
            clock,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        });

        expect(listDueStructureDriftSettings).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ now: new Date('2026-07-06T00:01:00.000Z') })
        );
        expect(claimDueStructureDriftSetting).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                leaseExpiresAt: new Date('2026-07-06T00:32:00.000Z'),
                now: new Date('2026-07-06T00:02:00.000Z'),
            })
        );
        expect(recordStructureScheduledDriftResult).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ now: new Date('2026-07-06T00:04:00.000Z') })
        );
        expect(clearStructureDriftSettingLease).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ now: new Date('2026-07-06T00:05:00.000Z') })
        );
        expect(listDueStructureBackupSettings).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ now: new Date('2026-07-06T00:06:00.000Z') })
        );
    });

    it('records clean scheduled drift without audit noise', async () => {
        vi.mocked(listDueStructureDriftSettings).mockResolvedValueOnce(ok([createBackupSettings('guild-clean')]));
        vi.mocked(listDueStructureBackupSettings).mockResolvedValueOnce(ok([]));
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId).mockResolvedValueOnce(
            ok(createBaselineBackup({ guildId: 'guild-clean' }))
        );
        vi.mocked(readFluxerGuildStructure).mockResolvedValueOnce(ok(createFluxerStructure('guild-clean')));

        await runDueStructureBackups({
            client,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            clock: createFixedClock(),
        });

        const recordInput = vi.mocked(recordStructureScheduledDriftResult).mock.calls[0]?.[1];

        expect(recordInput).toMatchObject({
            changeCount: 0,
            guildId: 'guild-clean',
            status: structureScheduledDriftStatuses.clean,
        });
        expect(recordInput).not.toHaveProperty('audit');
    });

    it('records scheduled drift no-baseline and live-read failures without stopping later guilds', async () => {
        vi.mocked(listDueStructureDriftSettings).mockResolvedValueOnce(
            ok([createBackupSettings('guild-missing'), createBackupSettings('guild-failed')])
        );
        vi.mocked(listDueStructureBackupSettings).mockResolvedValueOnce(ok([]));
        vi.mocked(findLatestStructureDriftBaselineBackupByGuildId)
            .mockResolvedValueOnce(err({ type: 'not-found' }))
            .mockResolvedValueOnce(ok(createBaselineBackup({ guildId: 'guild-failed' })));
        vi.mocked(readFluxerGuildStructure).mockResolvedValueOnce(
            err({ type: 'fetch-failed', error: new Error('No guild.') })
        );

        await runDueStructureBackups({
            client,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            clock: createFixedClock(),
        });

        const noBaselineInput = vi.mocked(recordStructureScheduledDriftResult).mock.calls[0]?.[1];

        expect(noBaselineInput).toMatchObject({
            guildId: 'guild-missing',
            status: structureScheduledDriftStatuses.noBaseline,
        });
        expect(noBaselineInput).not.toHaveProperty('audit');
        const expectedFailedAudit: unknown = expect.objectContaining({
            action: structureAuditActions.scheduledDriftFailed,
        });
        expect(recordStructureScheduledDriftResult).toHaveBeenNthCalledWith(
            2,
            {},
            expect.objectContaining({
                audit: expectedFailedAudit,
                errorMessage: 'Structure read failed: fetch-failed',
                guildId: 'guild-failed',
                status: structureScheduledDriftStatuses.failed,
            })
        );
        expect(clearStructureDriftSettingLease).toHaveBeenCalledTimes(2);
    });

    it('does not overlap scheduled backup runs', async () => {
        vi.useFakeTimers();
        let finishLookup: (() => void) | undefined;
        vi.mocked(listDueStructureBackupSettings).mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishLookup = () => resolve(ok([]));
                })
        );

        const scheduler = startStructureBackupScheduler({
            client,
            database: { db: {}, close: vi.fn() } as unknown as RuntimeDbClient,
            logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            clock: createFixedClock(),
        });

        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

        expect(listDueStructureBackupSettings).toHaveBeenCalledOnce();

        finishLookup?.();
        await scheduler.stop();
    });
});

function createBackupSettings(guildId: string) {
    return {
        guildId,
        enabled: true,
        cadenceWeeks: 1,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastErrorMessage: null,
        nextBackupAt: new Date('2026-07-06T00:00:00.000Z'),
        nextDriftCheckAt: new Date('2026-07-06T00:00:00.000Z'),
        nextRetentionPruneAt: new Date('2026-07-06T00:00:00.000Z'),
        lastDriftCheckedAt: null,
        lastDriftStatus: null,
        lastDriftErrorMessage: null,
        lastDriftChangeCount: null,
        lastDriftBaselineBackupId: null,
        lastDriftBaselineName: null,
        lastDriftSummary: null,
        lastDriftFieldSummary: null,
        lastDriftLiveCounts: null,
        lastDriftHasMorePreview: false,
        retentionDays: 180,
    };
}

function createFixedClock(): () => Date {
    return () => new Date('2026-07-06T00:00:00.000Z');
}

function createAdvancingClock(...timestamps: string[]): () => Date {
    let index = 0;

    return () => {
        const timestamp = timestamps[index];
        index += 1;

        if (!timestamp) {
            throw new Error('Test clock exhausted.');
        }

        return new Date(timestamp);
    };
}

function createFluxerStructure(guildId: string, input: { includeBotRole?: boolean } = {}) {
    return {
        guildId,
        guildName: guildId,
        roles: [
            {
                id: 'role-1',
                name: 'Member',
                position: 1,
                color: 0,
                permissions: '0',
                hoist: false,
                mentionable: false,
            },
            ...(input.includeBotRole
                ? [
                      {
                          id: 'bot-role',
                          name: 'Blueprint Bot',
                          position: 2,
                          color: 0,
                          permissions: '8',
                          hoist: true,
                          mentionable: false,
                          protected: true as const,
                          protectionReason: 'bot' as const,
                      },
                  ]
                : []),
        ],
        categories: [],
        channels: [
            {
                id: 'channel-1',
                name: 'general',
                type: 0,
                parentId: null,
                position: 1,
                permissionOverwrites: input.includeBotRole
                    ? [{ id: 'bot-role', type: 0 as const, allow: '8', deny: '0' }]
                    : [],
            },
        ],
    };
}

function createBackupRecord() {
    return {
        id: 'backup-1',
        guildId: 'guild-success',
        name: 'guild-success - 2026-07-06 - 00-00',
        createdByUserId: null,
        source: structureBackupSources.scheduled,
        status: structureBackupStatuses.succeeded,
        errorMessage: null,
        structure: {},
        roleCount: 1,
        categoryCount: 0,
        channelCount: 1,
        createdAt: new Date('2026-07-06T00:00:00.000Z'),
        completedAt: new Date('2026-07-06T00:00:00.000Z'),
    };
}

function createBaselineBackup(input: { guildId?: string; roleName?: string } = {}) {
    const guildId = input.guildId ?? 'guild-1';

    return {
        id: 'baseline-1',
        guildId,
        name: 'Baseline backup',
        createdByUserId: null,
        source: structureBackupSources.scheduled,
        status: structureBackupStatuses.succeeded,
        errorMessage: null,
        structure: {
            version: 1,
            guildId,
            guildName: guildId,
            exportedAt: '2026-07-05T00:00:00.000Z',
            roles: [
                {
                    id: 'role-1',
                    name: input.roleName ?? 'Member',
                    position: 1,
                    color: 0,
                    permissions: '0',
                    hoist: false,
                    mentionable: false,
                },
            ],
            categories: [],
            channels: [
                {
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
        },
        roleCount: 1,
        categoryCount: 0,
        channelCount: 1,
        createdAt: new Date('2026-07-05T00:00:00.000Z'),
        completedAt: new Date('2026-07-05T00:00:00.000Z'),
    };
}
