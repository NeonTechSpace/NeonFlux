import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const defaultReportPath = '.vitest/ci-test-results.json';
const skippedStatuses = new Set(['pending', 'skipped', 'todo', 'disabled']);

type VitestAssertionResult = {
    ancestorTitles: string[];
    duration?: number;
    failureMessages?: string[];
    fullName?: string;
    status: string;
    title: string;
};

type VitestFileResult = {
    assertionResults: VitestAssertionResult[];
    endTime?: number;
    name: string;
    startTime?: number;
    status: string;
};

export type VitestJsonReport = {
    numFailedTests: number;
    numPassedTests: number;
    numPendingTests: number;
    numTodoTests: number;
    numTotalTests: number;
    startTime: number;
    testResults: VitestFileResult[];
};

type TestTotals = {
    failed: number;
    passed: number;
    skipped: number;
    total: number;
};

type FileSummary = {
    durationMs: number;
    failedNames: string[];
    group: string;
    path: string;
    skippedNames: string[];
    status: 'failed' | 'passed' | 'skipped';
    tests: TestTotals;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await writeVitestCiSummary({
            reportPath: resolve(defaultReportPath),
            summaryPath: process.env.GITHUB_STEP_SUMMARY,
        });
    } catch {
        process.stderr.write('Vitest CI summary generation failed.\n');
        process.exitCode = 1;
    }
}

export async function writeVitestCiSummary(input: {
    reportPath: string;
    summaryPath: string | undefined;
}): Promise<void> {
    if (!input.summaryPath) throw new Error('missing-summary-path');

    let serialized: string;
    try {
        serialized = await readFile(input.reportPath, 'utf8');
    } catch {
        throw new Error('missing-vitest-report');
    }

    const report = parseVitestJsonReport(serialized);
    await appendFile(input.summaryPath, formatVitestCiSummary(report), 'utf8');
}

export function parseVitestJsonReport(serialized: string): VitestJsonReport {
    let value: unknown;
    try {
        value = JSON.parse(serialized) as unknown;
    } catch {
        throw new Error('malformed-vitest-report');
    }
    if (!isRecord(value) || !Array.isArray(value.testResults)) throw new Error('malformed-vitest-report');

    const countFields = [
        'numFailedTests',
        'numPassedTests',
        'numPendingTests',
        'numTodoTests',
        'numTotalTests',
    ] as const;
    if (countFields.some((field) => !isCount(value[field])) || !isFiniteNumber(value.startTime)) {
        throw new Error('malformed-vitest-report');
    }
    if (value.testResults.some((result) => !isFileResult(result))) throw new Error('malformed-vitest-report');

    return value as VitestJsonReport;
}

export function formatVitestCiSummary(report: VitestJsonReport): string {
    const files = report.testResults.map(summarizeFile);
    const fileTotals = totalsForFiles(files);
    const testTotals: TestTotals = {
        failed: report.numFailedTests,
        passed: report.numPassedTests,
        skipped: report.numPendingTests + report.numTodoTests,
        total: report.numTotalTests,
    };
    const durationMs = reportDuration(report);
    const groups = summarizeGroups(files);
    const slowest = [...files].sort((left, right) => right.durationMs - left.durationMs).slice(0, 10);
    const failedNames = files.flatMap((file) => file.failedNames.map((name) => `${file.path} — ${name}`));
    const skippedNames = files.flatMap((file) => file.skippedNames.map((name) => `${file.path} — ${name}`));

    return [
        '## Unit test results',
        '',
        `Duration: **${formatDuration(durationMs)}**`,
        '',
        '| Result | Total | Passed | Failed | Skipped |',
        '| --- | ---: | ---: | ---: | ---: |',
        totalsRow('Files', fileTotals),
        totalsRow('Tests', testTotals),
        '',
        '### Results by area',
        '',
        '| Area | Files | Tests | Passed | Failed | Skipped | Duration |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...groups.map(
            (group) =>
                `| ${escapeMarkdown(group.name)} | ${String(group.files)} | ${String(group.tests.total)} | ${String(group.tests.passed)} | ${String(group.tests.failed)} | ${String(group.tests.skipped)} | ${formatDuration(group.durationMs)} |`
        ),
        '',
        '### Slowest test files',
        '',
        '| File | Duration |',
        '| --- | ---: |',
        ...(slowest.length > 0
            ? slowest.map((file) => `| ${escapeMarkdown(file.path)} | ${formatDuration(file.durationMs)} |`)
            : ['| None | 0 ms |']),
        '',
        '### Failed tests',
        '',
        ...formatNameList(failedNames),
        '',
        '### Skipped tests',
        '',
        ...formatNameList(skippedNames),
        '',
    ].join('\n');
}

function summarizeFile(result: VitestFileResult): FileSummary {
    const path = toRepositoryPath(result.name);
    const failedNames = result.assertionResults.filter((test) => test.status === 'failed').map(readTestName);
    const skippedNames = result.assertionResults.filter((test) => isSkipped(test.status)).map(readTestName);
    const passed = result.assertionResults.filter((test) => test.status === 'passed').length;
    const failed = failedNames.length;
    const skipped = skippedNames.length;
    const status =
        result.status === 'failed' || failed > 0
            ? 'failed'
            : result.assertionResults.length > 0 && skipped === result.assertionResults.length
              ? 'skipped'
              : 'passed';
    return {
        durationMs: fileDuration(result),
        failedNames,
        group: groupForPath(path),
        path,
        skippedNames,
        status,
        tests: { failed, passed, skipped, total: result.assertionResults.length },
    };
}

function totalsForFiles(files: readonly FileSummary[]): TestTotals {
    return {
        failed: files.filter((file) => file.status === 'failed').length,
        passed: files.filter((file) => file.status === 'passed').length,
        skipped: files.filter((file) => file.status === 'skipped').length,
        total: files.length,
    };
}

function summarizeGroups(files: readonly FileSummary[]) {
    const groups = new Map<string, { durationMs: number; files: number; tests: TestTotals }>();
    for (const file of files) {
        const current = groups.get(file.group) ?? {
            durationMs: 0,
            files: 0,
            tests: { failed: 0, passed: 0, skipped: 0, total: 0 },
        };
        current.durationMs += file.durationMs;
        current.files += 1;
        current.tests.failed += file.tests.failed;
        current.tests.passed += file.tests.passed;
        current.tests.skipped += file.tests.skipped;
        current.tests.total += file.tests.total;
        groups.set(file.group, current);
    }

    return [...groups.entries()]
        .map(([name, group]) => ({ name, ...group }))
        .sort((left, right) => groupOrder(left.name) - groupOrder(right.name) || left.name.localeCompare(right.name));
}

function groupForPath(path: string): string {
    if (path.startsWith('apps/bot/')) return 'Bot';
    if (path.startsWith('apps/web/')) return 'Web';
    if (path.startsWith('convex/')) return 'Convex';
    const packageMatch = /^packages\/([^/]+)\//u.exec(path);
    return packageMatch?.[1] ? `Package: ${packageMatch[1]}` : 'Repository tooling';
}

function groupOrder(group: string): number {
    if (group === 'Bot') return 0;
    if (group === 'Web') return 1;
    if (group === 'Convex') return 2;
    if (group.startsWith('Package: ')) return 3;
    return 4;
}

function toRepositoryPath(path: string): string {
    const normalized = path.replaceAll('\\', '/');
    const markers = ['/apps/', '/convex/', '/packages/', '/scripts/'];
    const positions = markers.map((marker) => normalized.lastIndexOf(marker)).filter((index) => index >= 0);
    if (positions.length > 0) return normalized.slice(Math.max(...positions) + 1);
    if (/^(apps|convex|packages|scripts)\//u.test(normalized)) return normalized;
    return normalized.split('/').at(-1) ?? 'unknown-test-file';
}

function reportDuration(report: VitestJsonReport): number {
    const endTimes = report.testResults.flatMap((result) =>
        result.endTime !== undefined && Number.isFinite(result.endTime) ? [result.endTime] : []
    );
    return endTimes.length > 0 ? Math.max(0, Math.max(...endTimes) - report.startTime) : 0;
}

function fileDuration(result: VitestFileResult): number {
    if (result.startTime !== undefined && result.endTime !== undefined) {
        return Math.max(0, result.endTime - result.startTime);
    }
    return result.assertionResults.reduce((total, test) => total + (test.duration ?? 0), 0);
}

function readTestName(test: VitestAssertionResult): string {
    const fullName = test.fullName?.trim();
    if (fullName) return fullName;
    const composedName = [...test.ancestorTitles, test.title].join(' ').trim();
    return composedName ? composedName : 'Unnamed test';
}

function totalsRow(label: string, totals: TestTotals): string {
    return `| ${label} | ${String(totals.total)} | ${String(totals.passed)} | ${String(totals.failed)} | ${String(totals.skipped)} |`;
}

function formatNameList(names: readonly string[]): string[] {
    return names.length > 0 ? names.map((name) => `- ${escapeMarkdown(name)}`) : ['None.'];
}

function escapeMarkdown(value: string): string {
    return value
        .replace(/[\r\n\t]+/gu, ' ')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replace(/([\\`*_{}[\]()#+!|])/gu, '\\$1');
}

function formatDuration(durationMs: number): string {
    return durationMs < 1_000 ? `${String(Math.round(durationMs))} ms` : `${(durationMs / 1_000).toFixed(2)} s`;
}

function isSkipped(status: string): boolean {
    return skippedStatuses.has(status) || (status !== 'passed' && status !== 'failed');
}

function isFileResult(value: unknown): value is VitestFileResult {
    return (
        isRecord(value) &&
        typeof value.name === 'string' &&
        typeof value.status === 'string' &&
        (value.startTime === undefined || isFiniteNumber(value.startTime)) &&
        (value.endTime === undefined || isFiniteNumber(value.endTime)) &&
        Array.isArray(value.assertionResults) &&
        value.assertionResults.every(isAssertionResult)
    );
}

function isAssertionResult(value: unknown): value is VitestAssertionResult {
    return (
        isRecord(value) &&
        typeof value.title === 'string' &&
        typeof value.status === 'string' &&
        (value.fullName === undefined || typeof value.fullName === 'string') &&
        (value.duration === undefined || isFiniteNumber(value.duration)) &&
        (value.failureMessages === undefined ||
            (Array.isArray(value.failureMessages) &&
                value.failureMessages.every((message) => typeof message === 'string'))) &&
        Array.isArray(value.ancestorTitles) &&
        value.ancestorTitles.every((title) => typeof title === 'string')
    );
}

function isCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
