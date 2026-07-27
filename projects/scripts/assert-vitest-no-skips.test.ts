import { describe, expect, it } from 'vitest';

import { assertVitestReportHasNoSkips } from './assert-vitest-no-skips.js';
import type { VitestJsonReport } from './write-vitest-ci-summary.js';

describe('assertVitestReportHasNoSkips', () => {
    it('accepts a completed unit report', () => {
        expect(() => assertVitestReportHasNoSkips(createReport())).not.toThrow();
    });

    it.each(['pending', 'skipped', 'todo', 'disabled'])('rejects an unexplained %s unit case', (status) => {
        const report = createReport(status);
        expect(() => assertVitestReportHasNoSkips(report)).toThrow(
            'apps/web/src/example.test.ts — example remains protected'
        );
    });

    it('fails closed when aggregate and assertion skip counts disagree', () => {
        const report = createReport();
        report.numPendingTests = 1;
        expect(() => assertVitestReportHasNoSkips(report)).toThrow('skip accounting disagrees');
    });
});

function createReport(status = 'passed'): VitestJsonReport {
    const skipped = status === 'passed' || status === 'failed' ? 0 : 1;
    return {
        numFailedTests: status === 'failed' ? 1 : 0,
        numPassedTests: status === 'passed' ? 1 : 0,
        numPendingTests: skipped,
        numTodoTests: 0,
        numTotalTests: 1,
        startTime: 0,
        testResults: [
            {
                assertionResults: [
                    {
                        ancestorTitles: ['example'],
                        fullName: 'example remains protected',
                        status,
                        title: 'remains protected',
                    },
                ],
                name: 'C:\\repo\\projects\\apps\\web\\src\\example.test.ts',
                status: status === 'failed' ? 'failed' : 'passed',
            },
        ],
    };
}
