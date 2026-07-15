import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

import {
    e2eEphemeralSentinel,
    requireEphemeralSentinel,
    validateEphemeralConvexState,
} from '../apps/web/e2e/support/ephemeral-state.js';

const workspaceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDirectory = resolve(workspaceDirectory, 'apps/web');
const statePath = resolve(webDirectory, '.e2e-runtime/convex/state.json');
const logPath = resolve(webDirectory, '.e2e-runtime/blueprint-io-acceptance.jsonl');
const reportPath = resolve(webDirectory, '.e2e-runtime/blueprint-io-acceptance-report.json');
const acceptanceTestName = 'passes Blueprint I/O acceptance with twenty plans and a 474-step worker run';
const acceptanceSentinel = 'neonflux-blueprint-io-v1';
const markerFunctionName = 'runtime:blueprintIoAcceptanceMarker';
const markerLogPrefix = 'NEONFLUX_BLUEPRINT_IO_MARKER';

const historyFunctions = [
    'blueprint:listBlueprintPlanSummariesByGuildId',
    'blueprint:listLatestBlueprintPlanPreflightSummaries',
    'blueprint:listLatestBlueprintRunSummaries',
] as const;
const workerFunctions = [
    'blueprint:claimNextBlueprintRun',
    'blueprint:authorizeBlueprintRunMutation',
    'blueprint:ensureBlueprintRunRestorePoint',
    'blueprint:prepareBlueprintRunStepAttempt',
    'blueprint:startBlueprintRunStepAttempt',
    'blueprint:completeAndCheckpointBlueprintRunStepAttempt',
    'blueprint:checkpointBlueprintRun',
    'blueprint:finalizeBlueprintRun',
] as const;
const allowedHistoryFunctions = new Set<string>(historyFunctions);
const allowedWorkerFunctions = new Set<string>([...workerFunctions, 'blueprint:renewBlueprintRunLease']);
const allowedMeasuredFunctions = new Set<string>([...allowedHistoryFunctions, ...allowedWorkerFunctions]);

export type BlueprintIoWorkloadMarkers = {
    workerStart: string;
    workerEnd: string;
    historyStart: string;
    historyEnd: string;
};

export type BlueprintIoMetric = {
    functionName: string;
    readBytes: number;
    writeBytes: number;
};

export type BlueprintIoAggregate = BlueprintIoMetric & {
    requests: number;
    maximumReadBytes: number;
    maximumWriteBytes: number;
};

const expectedRequestCounts = new Map<string, number>([
    ['blueprint:listBlueprintPlanSummariesByGuildId', 1],
    ['blueprint:listLatestBlueprintPlanPreflightSummaries', 1],
    ['blueprint:listLatestBlueprintRunSummaries', 1],
    ['blueprint:claimNextBlueprintRun', 2],
    ['blueprint:authorizeBlueprintRunMutation', 1],
    ['blueprint:ensureBlueprintRunRestorePoint', 1],
    ['blueprint:prepareBlueprintRunStepAttempt', 475],
    ['blueprint:startBlueprintRunStepAttempt', 475],
    ['blueprint:completeAndCheckpointBlueprintRunStepAttempt', 475],
    ['blueprint:checkpointBlueprintRun', 1],
    ['blueprint:finalizeBlueprintRun', 1],
]);
const logDrainPollMs = 250;
const logDrainQuiescenceMs = 1_500;
const logDrainTimeoutMs = 30_000;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    const pnpmEntrypoint = process.env.npm_execpath;
    if (!pnpmEntrypoint) throw new Error('Blueprint I/O acceptance must be started through pnpm.');
    const ownedEnvironment = {
        ...withoutProjectCredentials(process.env),
        NEONFLUX_E2E_EPHEMERAL_SENTINEL: e2eEphemeralSentinel,
    };
    const markers = createWorkloadMarkers();
    const readinessMarker = `readiness-${randomUUID()}`;
    requireEphemeralSentinel(ownedEnvironment);

    await mkdir(dirname(logPath), { recursive: true });
    await Promise.all([rm(logPath, { force: true }), rm(reportPath, { force: true })]);

    let started = false;
    let logProcess: ChildProcess | undefined;
    let logExit: Promise<number> | undefined;
    let flushLogs: (() => Promise<void>) | undefined;
    try {
        await runPnpm(['--filter', 'neonflux-web', 'e2e:convex:start'], ownedEnvironment);
        started = true;

        const state = validateEphemeralConvexState(
            JSON.parse(await readFile(statePath, 'utf8')) as unknown,
            workspaceDirectory
        );
        const runtimeEnvironment = parseOwnedRuntimeEnvironment(await readFile(state.runtimeEnvPath, 'utf8'));
        const fixtureEnvironment = parseOwnedRuntimeEnvironment(await readFile(state.fixtureEnvPath, 'utf8'));
        assertSelfHostedTarget(runtimeEnvironment, state.backendPort);
        assertFixtureTarget(fixtureEnvironment, state.backendPort, state.projectName);
        const selfHostedUrl = requireEnvironmentValue(runtimeEnvironment, 'CONVEX_SELF_HOSTED_URL');
        const selfHostedAdminKey = requireEnvironmentValue(runtimeEnvironment, 'CONVEX_SELF_HOSTED_ADMIN_KEY');

        const stream = startConvexLogStream(pnpmEntrypoint, {
            ...ownedEnvironment,
            ...runtimeEnvironment,
        });
        logProcess = stream.child;
        logExit = stream.exit;
        flushLogs = stream.flush;
        await stream.ready;

        await flushLogs();
        const readinessBaseline = countAcceptanceMarkerCompletions(await readFile(logPath, 'utf8').catch(() => ''));
        await failIfLogStreamExits(
            withTimeout(
                invokeAcceptanceMarker(selfHostedUrl, selfHostedAdminKey, readinessMarker),
                20_000,
                'Convex readiness marker invocation timed out.'
            ),
            logExit
        );
        await waitForAcceptanceMarker({
            baselineCount: readinessBaseline,
            child: logProcess,
            exit: logExit,
            flush: flushLogs,
            marker: readinessMarker,
        });

        await failIfLogStreamExits(
            runPnpm(
                [
                    'exec',
                    'vitest',
                    'run',
                    'apps/web/e2e/support/authenticated-services.test.ts',
                    '--maxWorkers=1',
                    '--testNamePattern',
                    acceptanceTestName,
                ],
                {
                    ...ownedEnvironment,
                    ...fixtureEnvironment,
                    CONVEX_SELF_HOSTED_ADMIN_KEY: selfHostedAdminKey,
                    CONVEX_SELF_HOSTED_URL: selfHostedUrl,
                    NEONFLUX_BLUEPRINT_IO_ACCEPTANCE: acceptanceSentinel,
                    NEONFLUX_BLUEPRINT_IO_HISTORY_END_MARKER: markers.historyEnd,
                    NEONFLUX_BLUEPRINT_IO_HISTORY_START_MARKER: markers.historyStart,
                    NEONFLUX_BLUEPRINT_IO_WORKER_END_MARKER: markers.workerEnd,
                    NEONFLUX_BLUEPRINT_IO_WORKER_START_MARKER: markers.workerStart,
                    NEONFLUX_E2E_AUTHENTICATED: e2eEphemeralSentinel,
                }
            ),
            logExit
        );
        await waitForExpectedMetricsAndQuiescence({
            child: logProcess,
            exit: logExit,
            flush: flushLogs,
            markers,
        });
        await stopChild(logProcess, logExit);
        await flushLogs();
        logProcess = undefined;
        logExit = undefined;
        flushLogs = undefined;

        const metrics = extractBlueprintIoWorkloadMetrics(await readFile(logPath, 'utf8'), markers);
        const aggregates = aggregateBlueprintIoMetrics(metrics);
        assertBlueprintIoAcceptance(aggregates);
        await assertSummaryFunctionsHaveNoColdDependencies();
        await assertStepExecutionDependencies();
        const workerReadBytes = sumReadBytes(aggregates, workerFunctions);
        const workerWriteBytes = sumWriteBytes(aggregates, workerFunctions);
        const report = {
            completedAt: new Date().toISOString(),
            historyReadBytes: sumReadBytes(aggregates, historyFunctions),
            historyWriteBytes: sumWriteBytes(aggregates, historyFunctions),
            workerReadBytes,
            workerWriteBytes,
            workerCombinedIoBytes: workerReadBytes + workerWriteBytes,
            functions: [...aggregates.values()].sort((left, right) =>
                left.functionName.localeCompare(right.functionName)
            ),
        };
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        process.stdout.write(`Raw Convex JSONL: ${logPath}\nReport: ${reportPath}\n`);
    } finally {
        if (logProcess && logExit) await stopChild(logProcess, logExit).catch(() => undefined);
        if (started) await runPnpm(['--filter', 'neonflux-web', 'e2e:convex:stop'], ownedEnvironment);
    }
}

function startConvexLogStream(
    pnpmEntrypoint: string,
    environment: NodeJS.ProcessEnv
): { child: ChildProcess; exit: Promise<number>; flush: () => Promise<void>; ready: Promise<void> } {
    const child = spawn(
        process.execPath,
        [pnpmEntrypoint, 'exec', 'convex', 'logs', '--success', '--jsonl', '--history', '10000'],
        {
            cwd: workspaceDirectory,
            env: environment,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    let buffered = '';
    let stderr = '';
    let writes = Promise.resolve();
    let readySettled = false;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const readyTimeout = setTimeout(() => {
        if (readySettled) return;
        readySettled = true;
        rejectReady(new Error('Convex log stream did not report readiness within 20 seconds.'));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/u);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            if (line.trim()) writes = writes.then(async () => appendFile(logPath, `${line}\n`, 'utf8'));
        }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
        process.stderr.write(chunk);
        stderr = `${stderr}${chunk}`.slice(-8_192);
        if (!readySettled && stripVTControlCharacters(stderr).includes('Watching logs')) {
            readySettled = true;
            clearTimeout(readyTimeout);
            resolveReady();
        }
    });
    const exit = new Promise<number>((resolveExit, reject) => {
        child.once('error', (error) => {
            if (!readySettled) {
                readySettled = true;
                clearTimeout(readyTimeout);
                rejectReady(new Error(`Convex log stream failed before readiness: ${error.message}`));
            }
            reject(error);
        });
        child.once('exit', (code) => {
            const exitCode = code ?? 1;
            if (!readySettled) {
                readySettled = true;
                clearTimeout(readyTimeout);
                rejectReady(new Error(`Convex log stream exited before readiness with code ${String(exitCode)}.`));
            }
            resolveExit(exitCode);
        });
    });
    return {
        child,
        exit,
        flush: async () => {
            if (!isChildRunning(child) && buffered.trim()) {
                writes = writes.then(async () => appendFile(logPath, `${buffered}\n`, 'utf8'));
                buffered = '';
            }
            await writes;
        },
        ready,
    };
}

export function parseBlueprintIoMetrics(source: string): BlueprintIoMetric[] {
    return parseConvexLogRecords(source).flatMap((value) => {
        const metric = completionMetric(value);
        return metric ? [metric] : [];
    });
}

export function extractBlueprintIoWorkloadMetrics(
    source: string,
    markers: BlueprintIoWorkloadMarkers
): BlueprintIoMetric[] {
    const records = parseConvexLogRecords(source);
    const indices = Object.fromEntries(
        Object.entries(markers).map(([name, marker]) => [name, findAcceptanceMarkerIndex(records, marker)])
    ) as Record<keyof BlueprintIoWorkloadMarkers, number>;
    const orderedIndices = [indices.workerStart, indices.workerEnd, indices.historyStart, indices.historyEnd];
    if (orderedIndices.some((index) => index < 0)) {
        throw new Error('Convex JSONL did not contain all Blueprint I/O workload phase markers.');
    }
    if (!(indices.workerStart < indices.workerEnd && indices.workerEnd < indices.historyStart)) {
        throw new Error('Blueprint I/O workload phase markers were out of order.');
    }
    if (!(indices.historyStart < indices.historyEnd)) {
        throw new Error('Blueprint I/O History phase markers were out of order.');
    }

    return [
        ...extractBlueprintPhaseMetrics(
            records.slice(indices.workerStart + 1, indices.workerEnd),
            'worker',
            allowedWorkerFunctions
        ),
        ...extractBlueprintPhaseMetrics(
            records.slice(indices.historyStart + 1, indices.historyEnd),
            'History',
            allowedHistoryFunctions
        ),
    ];
}

export function aggregateBlueprintIoMetrics(metrics: readonly BlueprintIoMetric[]): Map<string, BlueprintIoAggregate> {
    const aggregates = new Map<string, BlueprintIoAggregate>();
    for (const metric of metrics) {
        const current = aggregates.get(metric.functionName);
        aggregates.set(metric.functionName, {
            functionName: metric.functionName,
            maximumReadBytes: Math.max(current?.maximumReadBytes ?? 0, metric.readBytes),
            maximumWriteBytes: Math.max(current?.maximumWriteBytes ?? 0, metric.writeBytes),
            readBytes: (current?.readBytes ?? 0) + metric.readBytes,
            requests: (current?.requests ?? 0) + 1,
            writeBytes: (current?.writeBytes ?? 0) + metric.writeBytes,
        });
    }
    return aggregates;
}

export function assertBlueprintIoAcceptance(aggregates: ReadonlyMap<string, BlueprintIoAggregate>): void {
    for (const functionName of aggregates.keys()) {
        if (functionName.startsWith('blueprint:') && !allowedMeasuredFunctions.has(functionName)) {
            throw new Error(`Blueprint I/O acceptance observed unexpected measured function ${functionName}.`);
        }
    }
    for (const [functionName, expected] of expectedRequestCounts) {
        assertRequestCount(aggregates, functionName, expected);
    }
    assertRequestCount(aggregates, 'blueprint:renewBlueprintRunLease', 0);

    const completion = requireAggregate(aggregates, 'blueprint:completeAndCheckpointBlueprintRunStepAttempt');
    if (completion.maximumReadBytes > 64 * 1024) {
        throw new Error(`Blueprint completion read ${String(completion.maximumReadBytes)} bytes; maximum is 64 KiB.`);
    }
    for (const functionName of [
        'blueprint:prepareBlueprintRunStepAttempt',
        'blueprint:startBlueprintRunStepAttempt',
        'blueprint:completeAndCheckpointBlueprintRunStepAttempt',
    ]) {
        const step = requireAggregate(aggregates, functionName);
        if (step.maximumWriteBytes > 64 * 1024) {
            throw new Error(
                `${functionName} wrote ${String(step.maximumWriteBytes)} bytes in one request; maximum is 64 KiB.`
            );
        }
    }
    const historyReadBytes = sumReadBytes(aggregates, historyFunctions);
    if (historyReadBytes > 512 * 1024) {
        throw new Error(`Blueprint History read ${String(historyReadBytes)} bytes; maximum is 512 KiB.`);
    }
    const historyWriteBytes = sumWriteBytes(aggregates, historyFunctions);
    if (historyWriteBytes !== 0) {
        throw new Error(`Blueprint History wrote ${String(historyWriteBytes)} bytes; expected zero.`);
    }
    const claim = requireAggregate(aggregates, 'blueprint:claimNextBlueprintRun');
    if (claim.maximumReadBytes > 4 * 1024 * 1024) {
        throw new Error(`Blueprint reclaim claim read ${String(claim.maximumReadBytes)} bytes; maximum is 4 MiB.`);
    }
    const workerReadBytes = sumReadBytes(aggregates, workerFunctions);
    if (workerReadBytes > 32 * 1024 * 1024) {
        throw new Error(`Blueprint worker read ${String(workerReadBytes)} bytes; maximum is 32 MiB.`);
    }
    const workerWriteBytes = sumWriteBytes(aggregates, workerFunctions);
    if (workerWriteBytes > 32 * 1024 * 1024) {
        throw new Error(`Blueprint worker wrote ${String(workerWriteBytes)} bytes; maximum is 32 MiB.`);
    }
    if (workerReadBytes + workerWriteBytes > 64 * 1024 * 1024) {
        throw new Error(
            `Blueprint worker combined I/O was ${String(workerReadBytes + workerWriteBytes)} bytes; maximum is 64 MiB.`
        );
    }
}

function assertRequestCount(
    aggregates: ReadonlyMap<string, BlueprintIoAggregate>,
    functionName: string,
    expected: number
): void {
    const actual = aggregates.get(functionName)?.requests ?? 0;
    if (actual !== expected) {
        throw new Error(`${functionName} executed ${String(actual)} times; expected ${String(expected)}.`);
    }
}

function requireAggregate(
    aggregates: ReadonlyMap<string, BlueprintIoAggregate>,
    functionName: string
): BlueprintIoAggregate {
    const aggregate = aggregates.get(functionName);
    if (!aggregate) throw new Error(`Convex JSONL did not contain metrics for ${functionName}.`);
    return aggregate;
}

function sumReadBytes(aggregates: ReadonlyMap<string, BlueprintIoAggregate>, functionNames: readonly string[]): number {
    return functionNames.reduce((total, functionName) => total + (aggregates.get(functionName)?.readBytes ?? 0), 0);
}

function sumWriteBytes(
    aggregates: ReadonlyMap<string, BlueprintIoAggregate>,
    functionNames: readonly string[]
): number {
    return functionNames.reduce((total, functionName) => total + (aggregates.get(functionName)?.writeBytes ?? 0), 0);
}

async function failIfLogStreamExits(operation: Promise<void>, logExit: Promise<number>): Promise<void> {
    await Promise.race([
        operation,
        logExit.then((exitCode) => {
            throw new Error(`Convex log stream exited during the acceptance run with code ${String(exitCode)}.`);
        }),
    ]);
}

async function waitForExpectedMetricsAndQuiescence(input: {
    child: ChildProcess;
    exit: Promise<number>;
    flush: () => Promise<void>;
    markers: BlueprintIoWorkloadMarkers;
}): Promise<void> {
    const deadline = Date.now() + logDrainTimeoutMs;
    let lastCompletionCount = -1;
    let quiescentSince = 0;
    let lastDeficits: string[] = [];
    while (Date.now() < deadline) {
        if (!isChildRunning(input.child)) {
            const exitCode = await input.exit;
            throw new Error(`Convex log stream exited before metrics drained with code ${String(exitCode)}.`);
        }
        await input.flush();
        const source = await readFile(logPath, 'utf8').catch(() => '');
        if (!hasAllAcceptanceMarkers(source, Object.values(input.markers))) {
            lastCompletionCount = -1;
            quiescentSince = 0;
            lastDeficits = ['workload phase markers'];
            await wait(logDrainPollMs);
            continue;
        }
        const metrics = extractBlueprintIoWorkloadMetrics(source, input.markers);
        const aggregates = aggregateBlueprintIoMetrics(metrics);
        lastDeficits = [...expectedRequestCounts].flatMap(([functionName, expected]) => {
            const actual = aggregates.get(functionName)?.requests ?? 0;
            return actual >= expected ? [] : [`${functionName}: ${String(actual)}/${String(expected)}`];
        });
        if (lastDeficits.length === 0) {
            if (metrics.length !== lastCompletionCount) {
                lastCompletionCount = metrics.length;
                quiescentSince = Date.now();
            } else if (Date.now() - quiescentSince >= logDrainQuiescenceMs) {
                return;
            }
        } else {
            lastCompletionCount = metrics.length;
            quiescentSince = 0;
        }
        await wait(logDrainPollMs);
    }
    throw new Error(
        `Convex metrics did not drain before timeout. Missing completions: ${lastDeficits.join(', ') || 'none; stream never became quiescent'}.`
    );
}

async function waitForAcceptanceMarker(input: {
    baselineCount: number;
    child: ChildProcess;
    exit: Promise<number>;
    flush: () => Promise<void>;
    marker: string;
}): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (!isChildRunning(input.child)) {
            const exitCode = await input.exit;
            throw new Error(`Convex log stream exited before readiness marker with code ${String(exitCode)}.`);
        }
        await input.flush();
        const source = await readFile(logPath, 'utf8').catch(() => '');
        if (
            countAcceptanceMarkerCompletions(source) > input.baselineCount &&
            hasAllAcceptanceMarkers(source, [input.marker])
        ) {
            return;
        }
        await wait(logDrainPollMs);
    }
    throw new Error('Convex log stream did not observe the unique readiness marker within 20 seconds.');
}

function createWorkloadMarkers(): BlueprintIoWorkloadMarkers {
    const runId = randomUUID();
    return {
        workerStart: `worker-start-${runId}`,
        workerEnd: `worker-end-${runId}`,
        historyStart: `history-start-${runId}`,
        historyEnd: `history-end-${runId}`,
    };
}

async function invokeAcceptanceMarker(url: string, adminKey: string, marker: string): Promise<void> {
    const response = await fetch(`${url}/api/function`, {
        body: JSON.stringify({
            args: { marker },
            format: 'convex_encoded_json',
            path: markerFunctionName,
        }),
        headers: {
            Authorization: `Convex ${adminKey}`,
            'Content-Type': 'application/json',
        },
        method: 'POST',
    });
    const result = (await response.json()) as unknown;
    if (!response.ok || !isRecord(result) || result.status !== 'success' || result.value !== marker) {
        throw new Error('Convex readiness marker invocation failed.');
    }
}

function countAcceptanceMarkerCompletions(source: string): number {
    return parseConvexLogRecords(source).filter(
        (record) => record.kind === 'Completion' && record.identifier === markerFunctionName
    ).length;
}

function hasAllAcceptanceMarkers(source: string, markers: readonly string[]): boolean {
    const records = parseConvexLogRecords(source);
    return markers.every((marker) => findAcceptanceMarkerIndex(records, marker) >= 0);
}

function findAcceptanceMarkerIndex(records: ReadonlyArray<Record<string, unknown>>, marker: string): number {
    const markerText = `${markerLogPrefix} ${marker}`;
    return records.findIndex((record) => {
        const logLines = JSON.stringify(record.logLines);
        return (
            record.kind === 'Completion' &&
            record.identifier === markerFunctionName &&
            (record.error === null || record.error === undefined) &&
            record.willRetry !== true &&
            typeof logLines === 'string' &&
            logLines.includes(markerText)
        );
    });
}

function extractBlueprintPhaseMetrics(
    records: ReadonlyArray<Record<string, unknown>>,
    phase: 'worker' | 'History',
    allowedFunctions: ReadonlySet<string>
): BlueprintIoMetric[] {
    return records.flatMap((record) => {
        if (record.kind !== 'Completion' || typeof record.identifier !== 'string') return [];
        if (!record.identifier.startsWith('blueprint:')) return [];
        if (!allowedFunctions.has(record.identifier)) {
            throw new Error(`Unexpected Blueprint function ${record.identifier} completed during the ${phase} phase.`);
        }
        const metric = completionMetric(record);
        if (!metric) throw new Error(`Blueprint completion ${record.identifier} could not be measured.`);
        return [metric];
    });
}

function parseConvexLogRecords(source: string): Array<Record<string, unknown>> {
    return source.split(/\r?\n/u).flatMap((line) => {
        if (!line.trim()) return [];
        let value: unknown;
        try {
            value = JSON.parse(line) as unknown;
        } catch {
            throw new Error('Convex JSONL contained a malformed or truncated line.');
        }
        if (!isRecord(value)) throw new Error('Convex JSONL contained a malformed record.');
        return [value];
    });
}

function completionMetric(value: Record<string, unknown>): BlueprintIoMetric | undefined {
    if (value.kind !== 'Completion') return undefined;
    if (value.error !== null && value.error !== undefined) {
        throw new Error(`Convex function ${String(value.identifier)} completed with an unexpected error.`);
    }
    if (value.willRetry === true) {
        throw new Error(`Convex function ${String(value.identifier)} scheduled an unexpected retry.`);
    }
    const usage = isRecord(value.usageStats) ? value.usageStats : undefined;
    if (!usage || typeof value.identifier !== 'string') {
        throw new Error('Convex completion JSONL omitted its identifier or usage metrics.');
    }
    const readBytes = usage.databaseIoReadBytes;
    const writeBytes = usage.databaseIoWriteBytes;
    if (!isNonNegativeNumber(readBytes) || !isNonNegativeNumber(writeBytes)) {
        throw new Error(`Convex completion ${value.identifier} contained malformed I/O metrics.`);
    }
    return { functionName: value.identifier, readBytes, writeBytes };
}

async function assertSummaryFunctionsHaveNoColdDependencies(): Promise<void> {
    const summarySource = await readFile(
        resolve(workspaceDirectory, 'convex/blueprint/blueprint_history_summaries.ts'),
        'utf8'
    );
    const hotRecordsSource = await readFile(
        resolve(workspaceDirectory, 'convex/blueprint/blueprint_hot_records.ts'),
        'utf8'
    );
    const allowedSummaryImports = new Set([
        'convex/values',
        '../_generated/server.js',
        '../auth.js',
        './blueprint_hot_records.js',
    ]);
    const forbiddenSummaryImport = importSpecifiers(summarySource).find(
        (specifier) => !allowedSummaryImports.has(specifier)
    );
    if (forbiddenSummaryImport) {
        throw new Error(`Blueprint History summary module imports forbidden dependency ${forbiddenSummaryImport}.`);
    }
    const allowedHotRecordImports = new Set(['convex/values', '../_generated/dataModel.js']);
    const forbiddenHotRecordImport = importSpecifiers(hotRecordsSource).find(
        (specifier) => !allowedHotRecordImports.has(specifier)
    );
    if (forbiddenHotRecordImport) {
        throw new Error(`Blueprint hot-record serializer imports forbidden dependency ${forbiddenHotRecordImport}.`);
    }
    if (/\b(?:ctx|db)\b/u.test(hotRecordsSource)) {
        throw new Error('Blueprint hot-record serializer may not access a Convex context or database.');
    }
    if (
        /\b(?:query|internalQuery|mutation|internalMutation|action|internalAction|require)\s*\(/u.test(hotRecordsSource)
    ) {
        throw new Error('Blueprint hot-record serializer may not register or invoke Convex functions.');
    }
    const forbidden = [
        'blueprintPlanAuthorities',
        'blueprintPlanExecutionAuthorities',
        'blueprintPlanExecutionAuthorityBuckets',
        'blueprintPlanPreflightEvidence',
        'blueprintPlanSteps',
        'blueprintPlanDecisions',
        'blueprintRunCursors',
        'blueprintRunVerificationEvidence',
        'blueprintRunIdMappings',
    ];
    for (const [moduleName, source] of [
        ['History summary module', summarySource],
        ['hot-record serializer', hotRecordsSource],
    ] as const) {
        const coldTable = forbidden.find((table) => source.includes(table));
        if (coldTable) {
            throw new Error(`Blueprint ${moduleName} has a forbidden cold dependency on ${coldTable}.`);
        }
    }
}

function importSpecifiers(source: string): string[] {
    return [
        ...source.matchAll(/from\s+['"]([^'"]+)['"]/gu),
        ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/gu),
        ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/gu),
    ].flatMap((match) => (typeof match[1] === 'string' ? [match[1]] : []));
}

async function assertStepExecutionDependencies(): Promise<void> {
    const source = await readFile(
        resolve(workspaceDirectory, 'convex/blueprint/blueprint_run_step_attempts.ts'),
        'utf8'
    );
    const prepare = exportedFunctionSource(source, 'prepareBlueprintRunStepAttempt');
    const start = exportedFunctionSource(source, 'startBlueprintRunStepAttempt');
    const complete = exportedFunctionSource(source, 'completeAndCheckpointBlueprintRunStepAttempt');
    const planStepReads = prepare.match(/ctx\.db\.get\('blueprintPlanSteps'/gu)?.length ?? 0;
    if (planStepReads !== 1) {
        throw new Error(`Step preparation contains ${String(planStepReads)} full plan-step reads; expected one.`);
    }
    for (const [functionName, body] of [
        ['startBlueprintRunStepAttempt', start],
        ['completeAndCheckpointBlueprintRunStepAttempt', complete],
    ] as const) {
        const forbidden = ['blueprintPlanSteps', 'blueprintPlanAuthorities', 'blueprintPlanPreflightEvidence'];
        const dependency = forbidden.find((table) => body.includes(table));
        if (dependency) throw new Error(`${functionName} has a forbidden dependency on ${dependency}.`);
    }
}

function exportedFunctionSource(source: string, functionName: string): string {
    const start = source.indexOf(`export const ${functionName} =`);
    if (start < 0) throw new Error(`Could not inspect Convex function ${functionName}.`);
    const next = source.indexOf('\nexport const ', start + 1);
    return source.slice(start, next < 0 ? source.length : next);
}

function assertSelfHostedTarget(environment: NodeJS.ProcessEnv, backendPort: number): void {
    const expected = `http://127.0.0.1:${String(backendPort)}`;
    if (environment.CONVEX_SELF_HOSTED_URL !== expected || !environment.CONVEX_SELF_HOSTED_ADMIN_KEY) {
        throw new Error(
            'Refusing Blueprint I/O acceptance because Convex logs are not bound to the owned local backend.'
        );
    }
}

function assertFixtureTarget(environment: NodeJS.ProcessEnv, backendPort: number, projectName: string): void {
    const expected = `http://127.0.0.1:${String(backendPort)}`;
    if (environment.CONVEX_URL !== expected || environment.CONVEX_DEPLOYMENT !== projectName) {
        throw new Error(
            'Refusing Blueprint I/O acceptance because the fixture is not bound to the owned local backend.'
        );
    }
}

function parseOwnedRuntimeEnvironment(source: string): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
        if (!line) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) throw new Error(`Invalid owned runtime env line ${String(lineIndex + 1)}.`);
        const key = line.slice(0, separator);
        const value = JSON.parse(line.slice(separator + 1)) as unknown;
        if (typeof value !== 'string') throw new Error(`Owned runtime env value ${key} is not a string.`);
        environment[key] = value;
    }
    return environment;
}

function requireEnvironmentValue(environment: NodeJS.ProcessEnv, key: string): string {
    const value = environment[key];
    if (!value) throw new Error(`Owned runtime environment omitted ${key}.`);
    return value;
}

function withoutProjectCredentials(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const isolated = { ...environment };
    for (const key of Object.keys(isolated)) {
        const normalizedKey = key.toUpperCase();
        if (
            normalizedKey.startsWith('CONVEX_') ||
            normalizedKey.startsWith('NEONFLUX_') ||
            normalizedKey.startsWith('FLUXER_') ||
            normalizedKey === 'SESSION_SECRET'
        ) {
            Reflect.deleteProperty(isolated, key);
        }
    }
    return isolated;
}

async function runPnpm(args: readonly string[], environment: NodeJS.ProcessEnv): Promise<void> {
    const pnpmEntrypoint = process.env.npm_execpath;
    if (!pnpmEntrypoint) throw new Error('pnpm entrypoint is unavailable.');
    const child = spawn(process.execPath, [pnpmEntrypoint, ...args], {
        cwd: workspaceDirectory,
        env: environment,
        shell: false,
        stdio: 'inherit',
    });
    const exitCode = await new Promise<number>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolveExit(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`pnpm ${args.join(' ')} exited with code ${String(exitCode)}.`);
}

async function stopChild(child: ChildProcess, exit: Promise<number>): Promise<void> {
    if (!isChildRunning(child)) return;
    child.kill();
    await Promise.race([exit, wait(5_000)]);
    if (isChildRunning(child)) {
        child.kill('SIGKILL');
        await exit;
    }
}

function isChildRunning(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null;
}

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<T>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error(message)), milliseconds);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
