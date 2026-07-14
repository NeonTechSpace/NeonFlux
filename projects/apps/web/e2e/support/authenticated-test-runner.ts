import { appendFile } from 'node:fs/promises';

type AuthenticatedTestStep = {
    name: string;
    run: () => Promise<void>;
};

type AuthenticatedTestRun = {
    cleanup: (started: boolean) => Promise<void>;
    phases: readonly AuthenticatedTestStep[];
    start: () => Promise<void>;
};

type AuthenticatedTestPhaseResult = {
    durationMs: number;
    name: string;
    status: 'passed' | 'failed' | 'skipped';
};

export async function runAuthenticatedTests(testRun: AuthenticatedTestRun): Promise<void> {
    const errors: unknown[] = [];
    const results: AuthenticatedTestPhaseResult[] = [];
    let started = false;

    try {
        const startResult = await runPhase('Startup', testRun.start);
        results.push(startResult.result);
        if (startResult.error) {
            errors.push(new Error('Signed-in test environment startup failed.', { cause: startResult.error }));
        } else {
            started = true;
        }

        if (started) {
            for (const phase of testRun.phases) {
                const phaseResult = await runPhase(phase.name, phase.run);
                results.push(phaseResult.result);
                if (phaseResult.error) {
                    errors.push(new Error(`Signed-in test step ${phase.name} failed.`, { cause: phaseResult.error }));
                }
            }
        } else {
            results.push(
                ...testRun.phases.map((phase) => ({ durationMs: 0, name: phase.name, status: 'skipped' as const }))
            );
        }
    } finally {
        const cleanupResult = await runPhase('Cleanup', async () => testRun.cleanup(started));
        results.push(cleanupResult.result);
        if (cleanupResult.error) {
            errors.push(new Error('Signed-in test environment cleanup failed.', { cause: cleanupResult.error }));
        }
    }

    try {
        await appendGitHubSummary(results);
    } catch {
        errors.push(new Error('Signed-in test summary write failed.'));
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Signed-in test run failed.');
}

async function runPhase(
    name: string,
    run: () => Promise<void>
): Promise<{ error?: unknown; result: AuthenticatedTestPhaseResult }> {
    const startedAt = Date.now();
    try {
        await run();
        return { result: { durationMs: elapsedMilliseconds(startedAt), name, status: 'passed' } };
    } catch (error) {
        return { error, result: { durationMs: elapsedMilliseconds(startedAt), name, status: 'failed' } };
    }
}

async function appendGitHubSummary(results: readonly AuthenticatedTestPhaseResult[]): Promise<void> {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;

    const rows = results.map(
        (result) =>
            `| ${escapeMarkdownTableCell(result.name)} | ${formatStatus(result.status)} | ${String(result.durationMs)} ms |`
    );
    const markdown = [
        '',
        '### Signed-in test phases',
        '',
        '| Phase | Status | Duration |',
        '| --- | --- | ---: |',
        ...rows,
        '',
    ].join('\n');

    await appendFile(summaryPath, markdown, { encoding: 'utf8' });
}

function elapsedMilliseconds(startedAt: number): number {
    return Math.max(0, Date.now() - startedAt);
}

function escapeMarkdownTableCell(value: string): string {
    const normalized = Array.from(value)
        .map((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
        })
        .join('')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 80);
    let safeValue = (normalized || 'Unnamed phase')
        .replaceAll('\\', '\\\\')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    for (const symbol of ['|', '`', '*', '_', '[', ']', '(', ')', '#', '!']) {
        safeValue = safeValue.replaceAll(symbol, `\\${symbol}`);
    }
    return safeValue;
}

function formatStatus(status: AuthenticatedTestPhaseResult['status']): 'Passed' | 'Failed' | 'Skipped' {
    if (status === 'passed') return 'Passed';
    if (status === 'failed') return 'Failed';
    return 'Skipped';
}
