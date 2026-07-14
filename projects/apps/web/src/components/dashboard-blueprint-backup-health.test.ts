import { describe, expect, it } from 'vitest';

import type {
    DashboardBlueprintBackupSettings,
    DashboardBlueprintBackupSummary,
} from '../server/dashboard-blueprint-model.js';
import { deriveDashboardBlueprintBackupHealth } from './dashboard-blueprint-backup-health.js';

const nowMs = Date.parse('2026-07-09T12:00:00.000Z');
const formatDate = (value: string) => value;

describe('deriveDashboardBlueprintBackupHealth', () => {
    it('returns no issues when automatic backups are disabled and no backups exist', () => {
        expect(
            deriveDashboardBlueprintBackupHealth({
                backups: [],
                formatDate,
                nowMs,
                settings: createSettings({ enabled: false }),
            })
        ).toStrictEqual([]);
    });

    it('warns when automatic backups are enabled but no backup has succeeded', () => {
        expect(
            deriveDashboardBlueprintBackupHealth({
                backups: [],
                formatDate,
                nowMs,
                settings: createSettings({
                    enabled: true,
                    lastAttemptAt: '2026-07-09T10:00:00.000Z',
                }),
            })
        ).toContainEqual({
            detail: 'Last attempt: 2026-07-09T10:00:00.000Z.',
            href: '#server-blueprint-backup-settings',
            title: 'Automatic backups have not succeeded yet.',
            tone: 'warning',
            type: 'scheduled-never-succeeded',
        });
    });

    it('reports the latest backup failure and prefers settings error copy', () => {
        const issues = deriveDashboardBlueprintBackupHealth({
            backups: [createBackup({ errorMessage: 'Row failure', status: 'failed' })],
            formatDate,
            nowMs,
            settings: createSettings({ lastErrorMessage: 'Settings failure' }),
        });

        expect(issues[0]).toStrictEqual({
            detail: 'Settings failure',
            href: '#server-blueprint-backup-backup-1',
            title: 'Latest backup failed',
            tone: 'error',
            type: 'backup-failed',
        });
    });

    it('reports repeated backup failures when the first two regular backups failed', () => {
        const issues = deriveDashboardBlueprintBackupHealth({
            backups: [
                createBackup({ id: 'backup-2', status: 'failed' }),
                createBackup({ id: 'backup-1', status: 'failed' }),
            ],
            formatDate,
            nowMs,
            settings: createSettings(),
        });

        expect(issues[0]?.title).toBe('Repeated backup failures');
    });

    it('does not report an older failed backup when the latest regular backup succeeded', () => {
        const issues = deriveDashboardBlueprintBackupHealth({
            backups: [
                createBackup({ id: 'backup-2', status: 'succeeded' }),
                createBackup({ id: 'backup-1', status: 'failed' }),
            ],
            formatDate,
            nowMs,
            settings: createSettings(),
        });

        expect(issues.some((issue) => issue.type === 'backup-failed')).toBe(false);
    });

    it('does not let a restore-point backup mask the latest failed regular backup', () => {
        const issues = deriveDashboardBlueprintBackupHealth({
            backups: [
                createBackup({ id: 'restore-1', source: 'restore_point', status: 'succeeded' }),
                createBackup({ id: 'scheduled-1', source: 'scheduled', status: 'failed' }),
            ],
            formatDate,
            nowMs,
            settings: createSettings(),
        });

        expect(issues[0]).toMatchObject({
            href: '#server-blueprint-backup-scheduled-1',
            title: 'Latest backup failed',
            type: 'backup-failed',
        });
    });

    it('warns only after the scheduled backup grace window has elapsed', () => {
        const recent = deriveDashboardBlueprintBackupHealth({
            backups: [],
            formatDate,
            nowMs,
            settings: createSettings({
                enabled: true,
                lastSuccessAt: '2026-07-01T12:00:00.000Z',
                nextBackupAt: '2026-07-09T10:30:00.000Z',
            }),
        });
        const overdue = deriveDashboardBlueprintBackupHealth({
            backups: [],
            formatDate,
            nowMs,
            settings: createSettings({
                enabled: true,
                lastSuccessAt: '2026-07-01T12:00:00.000Z',
                nextBackupAt: '2026-07-09T09:59:59.999Z',
            }),
        });

        expect(recent.some((issue) => issue.type === 'scheduled-overdue')).toBe(false);
        expect(overdue).toContainEqual({
            detail: 'Next scheduled backup was due 2026-07-09T09:59:59.999Z.',
            href: '#server-blueprint-backup-settings',
            title: 'Scheduled backup is overdue.',
            tone: 'warning',
            type: 'scheduled-overdue',
        });
    });

    it('warns only after the retention prune grace window has elapsed', () => {
        const recent = deriveDashboardBlueprintBackupHealth({
            backups: [],
            formatDate,
            nowMs,
            settings: createSettings({ nextRetentionPruneAt: '2026-07-09T10:30:00.000Z' }),
        });
        const overdue = deriveDashboardBlueprintBackupHealth({
            backups: [],
            formatDate,
            nowMs,
            settings: createSettings({ nextRetentionPruneAt: '2026-07-09T09:59:59.999Z' }),
        });

        expect(recent.some((issue) => issue.type === 'retention-overdue')).toBe(false);
        expect(overdue).toContainEqual({
            detail: 'Expired backups may remain until the bot processes retention.',
            href: '#server-blueprint-backup-settings',
            title: 'Retention prune is overdue.',
            tone: 'warning',
            type: 'retention-overdue',
        });
    });

    it('ignores invalid timestamp strings for overdue checks', () => {
        const issues = deriveDashboardBlueprintBackupHealth({
            backups: [],
            formatDate,
            nowMs,
            settings: createSettings({
                enabled: true,
                lastSuccessAt: '2026-07-01T12:00:00.000Z',
                nextBackupAt: 'not-a-date',
                nextRetentionPruneAt: 'not-a-date',
            }),
        });

        expect(issues).toStrictEqual([]);
    });
});

function createSettings(overrides: Partial<DashboardBlueprintBackupSettings> = {}): DashboardBlueprintBackupSettings {
    return {
        cadenceWeeks: 1,
        enabled: false,
        retentionDays: 180,
        ...overrides,
    };
}

function createBackup(overrides: Partial<DashboardBlueprintBackupSummary> = {}): DashboardBlueprintBackupSummary {
    return {
        categoryCount: 1,
        channelCount: 1,
        completedAt: '2026-07-09T10:00:00.000Z',
        createdAt: '2026-07-09T10:00:00.000Z',
        id: 'backup-1',
        name: 'NeonSpace - 2026-07-09 - 10-00',
        roleCount: 1,
        source: 'manual',
        status: 'succeeded',
        ...overrides,
    };
}
