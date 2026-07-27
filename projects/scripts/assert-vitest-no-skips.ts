import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseVitestJsonReport, type VitestJsonReport } from './write-vitest-ci-summary.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const reportArgument = process.argv[2];
        if (!reportArgument) throw new Error('Unit skip assertion requires a Vitest JSON report path.');
        const report = parseVitestJsonReport(await readFile(resolve(reportArgument), 'utf8'));
        assertVitestReportHasNoSkips(report);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'Unit skip assertion failed.'}\n`);
        process.exitCode = 1;
    }
}

export function assertVitestReportHasNoSkips(report: VitestJsonReport): void {
    const skipped = report.testResults.flatMap((file) =>
        file.assertionResults
            .filter((test) => test.status !== 'passed' && test.status !== 'failed')
            .map((test) => {
                const explicitName = test.fullName?.trim();
                const name = explicitName ?? [...test.ancestorTitles, test.title].join(' ').trim();
                return `${repositoryPath(file.name)} — ${name ? name : 'Unnamed test'}`;
            })
    );
    const reportedSkipped = report.numPendingTests + report.numTodoTests;
    if (skipped.length !== reportedSkipped) {
        throw new Error(
            `Vitest skip accounting disagrees: report=${String(reportedSkipped)}, assertions=${String(skipped.length)}.`
        );
    }
    if (skipped.length > 0) {
        throw new Error(`Unit tests must not skip or defer cases:\n${skipped.map((name) => `- ${name}`).join('\n')}`);
    }
}

function repositoryPath(path: string): string {
    const normalized = path.replaceAll('\\', '/');
    const marker = '/projects/';
    const markerIndex = normalized.lastIndexOf(marker);
    return markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized;
}
