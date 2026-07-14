import { describe, expect, it } from 'vitest';

import type { DashboardBlueprintRunProgress } from '../server/dashboard-blueprint-contracts.js';
import { mergeDashboardBlueprintRunProgress } from './dashboard-blueprint-progress.js';

describe('Server Blueprint run progress', () => {
    it('accepts newer progress and rejects older or terminal-regressing updates', () => {
        const running = createRun({ completedSteps: 3, updatedAt: '2026-07-11T12:00:03.000Z' });
        const newer = createRun({ completedSteps: 4, updatedAt: '2026-07-11T12:00:04.000Z' });
        const older = createRun({ completedSteps: 2, updatedAt: '2026-07-11T12:00:02.000Z' });
        const terminal = createRun({
            completedSteps: 24,
            phase: 'complete',
            status: 'succeeded',
            updatedAt: '2026-07-11T12:01:00.000Z',
        });

        expect(mergeDashboardBlueprintRunProgress(running, newer)).toBe(newer);
        expect(mergeDashboardBlueprintRunProgress(running, older)).toBe(running);
        expect(mergeDashboardBlueprintRunProgress(terminal, newer)).toBe(terminal);
    });

    it('does not let a newer transport response move durable counters backwards', () => {
        const confirmed = createRun({
            completedSteps: 4,
            failedSteps: 1,
            updatedAt: '2026-07-11T12:00:04.000Z',
        });
        const regressing = createRun({
            completedSteps: 3,
            failedSteps: 0,
            updatedAt: '2026-07-11T12:00:05.000Z',
        });

        expect(mergeDashboardBlueprintRunProgress(confirmed, regressing)).toBe(confirmed);
    });

    it('does not merge contradictory protocol versions for one durable run', () => {
        const confirmed = createRun({ protocolVersion: 1 });
        const contradictory = createRun({
            protocolVersion: 2,
            updatedAt: '2026-07-11T12:00:05.000Z',
        });

        expect(mergeDashboardBlueprintRunProgress(confirmed, contradictory)).toBe(confirmed);
    });

    it('lets terminal state win when two sources report the same checkpoint time', () => {
        const running = createRun({ completedSteps: 24, updatedAt: '2026-07-11T12:01:00.000Z' });
        const terminal = createRun({
            completedSteps: 24,
            phase: 'complete',
            status: 'succeeded',
            updatedAt: '2026-07-11T12:01:00.000Z',
        });

        expect(mergeDashboardBlueprintRunProgress(running, terminal)).toBe(terminal);
        expect(mergeDashboardBlueprintRunProgress(terminal, running)).toBe(terminal);
    });

    it('accepts a newer run identity for a repeated apply of the same run', () => {
        const completed = createRun({
            completedSteps: 24,
            completedAt: '2026-07-11T12:01:00.000Z',
            phase: 'complete',
            status: 'succeeded',
            updatedAt: '2026-07-11T12:01:00.000Z',
        });
        const repeatedApply = createRun({
            id: 'run-2',
            completedSteps: 0,
            createdAt: '2026-07-11T12:02:00.000Z',
            totalSteps: 2,
            updatedAt: '2026-07-11T12:02:00.000Z',
        });

        expect(mergeDashboardBlueprintRunProgress(completed, repeatedApply)).toBe(repeatedApply);
    });

    it('rejects stale, tied, or malformed different run identities', () => {
        const current = createRun({
            id: 'run-current',
            createdAt: '2026-07-11T12:02:00.000Z',
            updatedAt: '2026-07-11T12:02:01.000Z',
        });
        const older = createRun({ id: 'run-older', createdAt: '2026-07-11T12:01:00.000Z' });
        const tied = createRun({ id: 'run-tied', createdAt: current.createdAt });
        const malformedIncoming = createRun({ id: 'run-invalid', createdAt: 'not-a-timestamp' });
        const malformedPrevious = createRun({ id: 'run-bad-current', createdAt: 'not-a-timestamp' });
        const otherwiseValidIncoming = createRun({
            id: 'run-new',
            createdAt: '2026-07-11T12:03:00.000Z',
        });

        expect(mergeDashboardBlueprintRunProgress(current, older)).toBe(current);
        expect(mergeDashboardBlueprintRunProgress(current, tied)).toBe(current);
        expect(mergeDashboardBlueprintRunProgress(current, malformedIncoming)).toBe(current);
        expect(mergeDashboardBlueprintRunProgress(malformedPrevious, otherwiseValidIncoming)).toBe(malformedPrevious);
    });
});

function createRun(overrides: Partial<DashboardBlueprintRunProgress> = {}): DashboardBlueprintRunProgress {
    return {
        id: 'run-1',
        protocolVersion: 1,
        status: 'running',
        phase: 'update',
        completedSteps: 0,
        failedSteps: 0,
        totalSteps: 24,
        createdAt: '2026-07-11T12:00:00.000Z',
        updatedAt: '2026-07-11T12:00:00.000Z',
        ...overrides,
    };
}
