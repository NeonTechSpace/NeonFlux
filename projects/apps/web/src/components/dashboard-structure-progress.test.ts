import { describe, expect, it } from 'vitest';

import type { DashboardStructureExecutionProgress } from '../server/dashboard-structure-v2.js';
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
});

function createExecution(
    overrides: Partial<DashboardStructureExecutionProgress> = {}
): DashboardStructureExecutionProgress {
    return {
        id: 'execution-1',
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
