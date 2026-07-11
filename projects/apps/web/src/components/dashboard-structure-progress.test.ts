import { describe, expect, it } from 'vitest';

import type { DashboardStructureExecutionProgress } from '../server/dashboard-structure-contracts.js';
import { mergeDashboardStructureExecutionProgress } from './dashboard-structure-progress.js';

describe('Server Blueprint execution progress', () => {
    it('accepts newer progress and rejects older or terminal-regressing updates', () => {
        const running = createExecution({ completedActions: 3, updatedAt: '2026-07-11T12:00:03.000Z' });
        const newer = createExecution({ completedActions: 4, updatedAt: '2026-07-11T12:00:04.000Z' });
        const older = createExecution({ completedActions: 2, updatedAt: '2026-07-11T12:00:02.000Z' });
        const terminal = createExecution({
            completedActions: 24,
            phase: 'complete',
            status: 'succeeded',
            updatedAt: '2026-07-11T12:01:00.000Z',
        });

        expect(mergeDashboardStructureExecutionProgress(running, newer)).toBe(newer);
        expect(mergeDashboardStructureExecutionProgress(running, older)).toBe(running);
        expect(mergeDashboardStructureExecutionProgress(terminal, newer)).toBe(terminal);
    });

    it('does not let a newer transport response move durable counters backwards', () => {
        const confirmed = createExecution({
            completedActions: 4,
            failedActions: 1,
            updatedAt: '2026-07-11T12:00:04.000Z',
        });
        const regressing = createExecution({
            completedActions: 3,
            failedActions: 0,
            updatedAt: '2026-07-11T12:00:05.000Z',
        });

        expect(mergeDashboardStructureExecutionProgress(confirmed, regressing)).toBe(confirmed);
    });

    it('does not merge contradictory protocol versions for one durable execution', () => {
        const confirmed = createExecution({ protocolVersion: 1 });
        const contradictory = createExecution({
            protocolVersion: 2,
            updatedAt: '2026-07-11T12:00:05.000Z',
        });

        expect(mergeDashboardStructureExecutionProgress(confirmed, contradictory)).toBe(confirmed);
    });

    it('lets terminal state win when two sources report the same checkpoint time', () => {
        const running = createExecution({ completedActions: 24, updatedAt: '2026-07-11T12:01:00.000Z' });
        const terminal = createExecution({
            completedActions: 24,
            phase: 'complete',
            status: 'succeeded',
            updatedAt: '2026-07-11T12:01:00.000Z',
        });

        expect(mergeDashboardStructureExecutionProgress(running, terminal)).toBe(terminal);
        expect(mergeDashboardStructureExecutionProgress(terminal, running)).toBe(terminal);
    });

    it('accepts a newer execution identity for a repeated apply of the same run', () => {
        const completed = createExecution({
            completedActions: 24,
            completedAt: '2026-07-11T12:01:00.000Z',
            phase: 'complete',
            status: 'succeeded',
            updatedAt: '2026-07-11T12:01:00.000Z',
        });
        const repeatedApply = createExecution({
            id: 'execution-2',
            completedActions: 0,
            createdAt: '2026-07-11T12:02:00.000Z',
            totalActions: 2,
            updatedAt: '2026-07-11T12:02:00.000Z',
        });

        expect(mergeDashboardStructureExecutionProgress(completed, repeatedApply)).toBe(repeatedApply);
    });

    it('rejects stale, tied, or malformed different execution identities', () => {
        const current = createExecution({
            id: 'execution-current',
            createdAt: '2026-07-11T12:02:00.000Z',
            updatedAt: '2026-07-11T12:02:01.000Z',
        });
        const older = createExecution({ id: 'execution-older', createdAt: '2026-07-11T12:01:00.000Z' });
        const tied = createExecution({ id: 'execution-tied', createdAt: current.createdAt });
        const malformedIncoming = createExecution({ id: 'execution-invalid', createdAt: 'not-a-timestamp' });
        const malformedPrevious = createExecution({ id: 'execution-bad-current', createdAt: 'not-a-timestamp' });
        const otherwiseValidIncoming = createExecution({
            id: 'execution-new',
            createdAt: '2026-07-11T12:03:00.000Z',
        });

        expect(mergeDashboardStructureExecutionProgress(current, older)).toBe(current);
        expect(mergeDashboardStructureExecutionProgress(current, tied)).toBe(current);
        expect(mergeDashboardStructureExecutionProgress(current, malformedIncoming)).toBe(current);
        expect(mergeDashboardStructureExecutionProgress(malformedPrevious, otherwiseValidIncoming)).toBe(
            malformedPrevious
        );
    });
});

function createExecution(
    overrides: Partial<DashboardStructureExecutionProgress> = {}
): DashboardStructureExecutionProgress {
    return {
        id: 'execution-1',
        protocolVersion: 1,
        status: 'running',
        phase: 'update',
        completedActions: 0,
        failedActions: 0,
        totalActions: 24,
        createdAt: '2026-07-11T12:00:00.000Z',
        updatedAt: '2026-07-11T12:00:00.000Z',
        ...overrides,
    };
}
