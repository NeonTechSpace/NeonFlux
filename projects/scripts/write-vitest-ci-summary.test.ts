import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
    formatVitestCiSummary,
    parseVitestJsonReport,
    writeVitestCiSummary,
    type VitestJsonReport,
} from './write-vitest-ci-summary.js';

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('Vitest CI summary', () => {
    it('groups Windows and Linux paths without exposing machine paths or failure payloads', () => {
        const report = createReport();
        const summary = formatVitestCiSummary(report);

        expect(summary).toContain('| Files | 6 | 4 | 1 | 1 |');
        expect(summary).toContain('| Tests | 7 | 5 | 1 | 1 |');
        expect(summary).toContain('| Bot | 1 | 1 | 1 | 0 | 0 |');
        expect(summary).toContain('| Web | 1 | 2 | 1 | 1 | 0 |');
        expect(summary).toContain('| Convex | 1 | 1 | 1 | 0 | 0 |');
        expect(summary).toContain('| Package: blueprint | 1 | 1 | 1 | 0 | 0 |');
        expect(summary).toContain('| Package: db | 1 | 1 | 0 | 0 | 1 |');
        expect(summary).toContain('| Repository tooling | 1 | 1 | 1 | 0 | 0 |');
        expect(summary).toContain('apps/web/src/server/unsafe\\|name.test.ts');
        expect(summary).toContain('rejects &lt;script&gt; and \\# heading');
        expect(summary).not.toContain('M:/NeonFlux');
        expect(summary).not.toContain('/home/runner/work');
        expect(summary).not.toContain('SECRET_FAILURE_PAYLOAD');
        expect(summary).not.toContain('<script>');
    });

    it('lists only test names for failed and skipped tests', () => {
        const summary = formatVitestCiSummary(createReport());

        expect(summary).toContain('### Failed tests');
        expect(summary).toContain('Web boundary rejects &lt;script&gt; and \\# heading');
        expect(summary).toContain('### Skipped tests');
        expect(summary).toContain('DB adapter deferred case');
    });

    it('parses the Vitest v4 JSON shape and rejects malformed reports', () => {
        const report = createReport();

        expect(parseVitestJsonReport(JSON.stringify(report))).toEqual(report);
        expect(() => parseVitestJsonReport('{')).toThrow('malformed-vitest-report');
        expect(() => parseVitestJsonReport(JSON.stringify({ ...report, numTotalTests: '7' }))).toThrow(
            'malformed-vitest-report'
        );
        expect(() => parseVitestJsonReport(JSON.stringify({ ...report, testResults: [{ name: 'bad' }] }))).toThrow(
            'malformed-vitest-report'
        );
    });

    it('appends a summary and fails closed for missing or malformed input', async () => {
        const root = await createTempRoot();
        const reportPath = join(root, 'report.json');
        const summaryPath = join(root, 'summary.md');
        await writeFile(reportPath, JSON.stringify(createReport()));
        await writeFile(summaryPath, 'Existing summary\n');

        await writeVitestCiSummary({ reportPath, summaryPath });

        await expect(readFile(summaryPath, 'utf8')).resolves.toContain('Existing summary\n## Unit test results');
        await expect(writeVitestCiSummary({ reportPath: join(root, 'missing.json'), summaryPath })).rejects.toThrow(
            'missing-vitest-report'
        );
        await writeFile(reportPath, 'not json');
        await expect(writeVitestCiSummary({ reportPath, summaryPath })).rejects.toThrow('malformed-vitest-report');
        await expect(writeVitestCiSummary({ reportPath, summaryPath: undefined })).rejects.toThrow(
            'missing-summary-path'
        );
    });
});

async function createTempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'neonflux-vitest-summary-'));
    tempRoots.push(root);
    return root;
}

function createReport(): VitestJsonReport {
    return {
        numFailedTests: 1,
        numPassedTests: 5,
        numPendingTests: 1,
        numTodoTests: 0,
        numTotalTests: 7,
        startTime: 1_000,
        testResults: [
            file('M:\\NeonFlux\\projects\\apps\\bot\\src\\worker.test.ts', 'passed', 1_100, 1_200, [
                test('Bot worker succeeds', 'passed', 10),
            ]),
            file(
                '/home/runner/work/NeonFlux/projects/apps/web/src/server/unsafe|name.test.ts',
                'failed',
                1_050,
                1_700,
                [
                    test('Web boundary succeeds', 'passed', 5),
                    {
                        ...test('Web boundary rejects <script> and # heading', 'failed', 15),
                        failureMessages: ['SECRET_FAILURE_PAYLOAD'],
                    },
                ]
            ),
            file('/home/runner/work/NeonFlux/projects/convex/model.test.ts', 'passed', 1_100, 1_150, [
                test('Convex model succeeds', 'passed', 2),
            ]),
            file('/home/runner/work/NeonFlux/projects/packages/blueprint/src/digest.test.ts', 'passed', 1_100, 1_400, [
                test('Blueprint digest succeeds', 'passed', 3),
            ]),
            file('/home/runner/work/NeonFlux/projects/packages/db/src/runtime.test.ts', 'passed', 1_100, 1_110, [
                test('DB adapter deferred case', 'pending', 0),
            ]),
            file('/home/runner/work/NeonFlux/projects/scripts/tooling.test.ts', 'passed', 1_100, 1_120, [
                test('Tooling succeeds', 'passed', 1),
            ]),
        ],
    };
}

function file(
    name: string,
    status: string,
    startTime: number,
    endTime: number,
    assertionResults: VitestJsonReport['testResults'][number]['assertionResults']
): VitestJsonReport['testResults'][number] {
    return { assertionResults, endTime, name, startTime, status };
}

function test(title: string, status: string, duration: number) {
    return { ancestorTitles: [], duration, fullName: title, status, title };
}
