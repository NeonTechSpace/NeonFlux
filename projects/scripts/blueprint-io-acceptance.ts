import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

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
const historyColdTables = [
    'blueprintPlanAuthorities',
    'blueprintPlanExecutionAuthorities',
    'blueprintPlanExecutionAuthorityBuckets',
    'blueprintPlanPreflightEvidence',
    'blueprintPlanSteps',
    'blueprintPlanDecisions',
    'blueprintRunCursors',
    'blueprintRunVerificationEvidence',
    'blueprintRunIdMappings',
] as const;

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

export type BlueprintIoWorkloadMetrics = {
    worker: BlueprintIoMetric[];
    history: BlueprintIoMetric[];
};

export type BlueprintIoWorkloadAggregates = {
    worker: Map<string, BlueprintIoAggregate>;
    history: Map<string, BlueprintIoAggregate>;
};

const expectedWorkerRequestCounts = new Map<string, number>([
    ['blueprint:claimNextBlueprintRun', 2],
    ['blueprint:authorizeBlueprintRunMutation', 1],
    ['blueprint:ensureBlueprintRunRestorePoint', 1],
    ['blueprint:prepareBlueprintRunStepAttempt', 475],
    ['blueprint:startBlueprintRunStepAttempt', 475],
    ['blueprint:completeAndCheckpointBlueprintRunStepAttempt', 475],
    ['blueprint:checkpointBlueprintRun', 1],
    ['blueprint:finalizeBlueprintRun', 1],
    ['blueprint:renewBlueprintRunLease', 0],
]);
const expectedHistoryRequestCounts = new Map<string, number>([
    ['blueprint:listBlueprintPlanSummariesByGuildId', 1],
    ['blueprint:listLatestBlueprintPlanPreflightSummaries', 1],
    ['blueprint:listLatestBlueprintRunSummaries', 1],
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
        await withTimeout(stream.spawned, 20_000, 'Convex log stream did not spawn within 20 seconds.');

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
        const aggregates = aggregateBlueprintIoWorkloadMetrics(metrics);
        assertBlueprintIoAcceptance(aggregates);
        await assertSummaryFunctionsHaveNoColdDependencies();
        await assertStepExecutionDependencies();
        const workerReadBytes = sumAllReadBytes(aggregates.worker);
        const workerWriteBytes = sumAllWriteBytes(aggregates.worker);
        const report = {
            completedAt: new Date().toISOString(),
            historyReadBytes: sumAllReadBytes(aggregates.history),
            historyWriteBytes: sumAllWriteBytes(aggregates.history),
            workerReadBytes,
            workerWriteBytes,
            workerCombinedIoBytes: workerReadBytes + workerWriteBytes,
            functions: [
                ...[...aggregates.worker.values()].map((metric) => ({ phase: 'worker' as const, ...metric })),
                ...[...aggregates.history.values()].map((metric) => ({ phase: 'history' as const, ...metric })),
            ].sort((left, right) => left.functionName.localeCompare(right.functionName)),
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
): { child: ChildProcess; exit: Promise<number>; flush: () => Promise<void>; spawned: Promise<void> } {
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
    let writes = Promise.resolve();
    let spawnSettled = false;
    let resolveSpawned!: () => void;
    let rejectSpawned!: (error: Error) => void;
    const spawned = new Promise<void>((resolve, reject) => {
        resolveSpawned = resolve;
        rejectSpawned = reject;
    });
    child.once('spawn', () => {
        spawnSettled = true;
        resolveSpawned();
    });
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
    });
    const exit = new Promise<number>((resolveExit, reject) => {
        child.once('error', (error) => {
            if (!spawnSettled) rejectSpawned(new Error(`Convex log stream failed to spawn: ${error.message}`));
            reject(error);
        });
        child.once('exit', (code) => {
            const exitCode = code ?? 1;
            if (!spawnSettled)
                rejectSpawned(new Error(`Convex log stream exited before spawning with code ${String(exitCode)}.`));
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
        spawned,
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
): BlueprintIoWorkloadMetrics {
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

    return {
        worker: extractBlueprintPhaseMetrics(
            records.slice(indices.workerStart + 1, indices.workerEnd),
            'worker',
            allowedWorkerFunctions
        ),
        history: extractBlueprintPhaseMetrics(
            records.slice(indices.historyStart + 1, indices.historyEnd),
            'History',
            allowedHistoryFunctions
        ),
    };
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

export function aggregateBlueprintIoWorkloadMetrics(
    metrics: BlueprintIoWorkloadMetrics
): BlueprintIoWorkloadAggregates {
    return {
        worker: aggregateBlueprintIoMetrics(metrics.worker),
        history: aggregateBlueprintIoMetrics(metrics.history),
    };
}

export function assertBlueprintIoAcceptance(aggregates: BlueprintIoWorkloadAggregates): void {
    assertAllowedAggregates(aggregates.worker, allowedWorkerFunctions, 'worker');
    assertAllowedAggregates(aggregates.history, allowedHistoryFunctions, 'History');
    assertExpectedRequestCounts(aggregates.worker, expectedWorkerRequestCounts);
    assertExpectedRequestCounts(aggregates.history, expectedHistoryRequestCounts);

    const completion = requireAggregate(aggregates.worker, 'blueprint:completeAndCheckpointBlueprintRunStepAttempt');
    if (completion.maximumReadBytes > 64 * 1024) {
        throw new Error(`Blueprint completion read ${String(completion.maximumReadBytes)} bytes; maximum is 64 KiB.`);
    }
    for (const functionName of [
        'blueprint:prepareBlueprintRunStepAttempt',
        'blueprint:startBlueprintRunStepAttempt',
        'blueprint:completeAndCheckpointBlueprintRunStepAttempt',
    ]) {
        const step = requireAggregate(aggregates.worker, functionName);
        if (step.maximumWriteBytes > 64 * 1024) {
            throw new Error(
                `${functionName} wrote ${String(step.maximumWriteBytes)} bytes in one request; maximum is 64 KiB.`
            );
        }
    }
    const historyReadBytes = sumAllReadBytes(aggregates.history);
    if (historyReadBytes > 512 * 1024) {
        throw new Error(`Blueprint History read ${String(historyReadBytes)} bytes; maximum is 512 KiB.`);
    }
    const historyWriteBytes = sumAllWriteBytes(aggregates.history);
    if (historyWriteBytes !== 0) {
        throw new Error(`Blueprint History wrote ${String(historyWriteBytes)} bytes; expected zero.`);
    }
    const claim = requireAggregate(aggregates.worker, 'blueprint:claimNextBlueprintRun');
    if (claim.maximumReadBytes > 4 * 1024 * 1024) {
        throw new Error(`Blueprint reclaim claim read ${String(claim.maximumReadBytes)} bytes; maximum is 4 MiB.`);
    }
    const workerReadBytes = sumAllReadBytes(aggregates.worker);
    if (workerReadBytes > 32 * 1024 * 1024) {
        throw new Error(`Blueprint worker read ${String(workerReadBytes)} bytes; maximum is 32 MiB.`);
    }
    const workerWriteBytes = sumAllWriteBytes(aggregates.worker);
    if (workerWriteBytes > 32 * 1024 * 1024) {
        throw new Error(`Blueprint worker wrote ${String(workerWriteBytes)} bytes; maximum is 32 MiB.`);
    }
    if (workerReadBytes + workerWriteBytes > 64 * 1024 * 1024) {
        throw new Error(
            `Blueprint worker combined I/O was ${String(workerReadBytes + workerWriteBytes)} bytes; maximum is 64 MiB.`
        );
    }
}

function assertAllowedAggregates(
    aggregates: ReadonlyMap<string, BlueprintIoAggregate>,
    allowedFunctions: ReadonlySet<string>,
    phase: 'worker' | 'History'
): void {
    for (const functionName of aggregates.keys()) {
        if (!allowedFunctions.has(functionName)) {
            throw new Error(`Unexpected Convex function ${functionName} completed during the ${phase} phase.`);
        }
    }
}

function assertExpectedRequestCounts(
    aggregates: ReadonlyMap<string, BlueprintIoAggregate>,
    expectedCounts: ReadonlyMap<string, number>
): void {
    for (const [functionName, expected] of expectedCounts) assertRequestCount(aggregates, functionName, expected);
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

function sumAllReadBytes(aggregates: ReadonlyMap<string, BlueprintIoAggregate>): number {
    return [...aggregates.values()].reduce((total, metric) => total + metric.readBytes, 0);
}

function sumAllWriteBytes(aggregates: ReadonlyMap<string, BlueprintIoAggregate>): number {
    return [...aggregates.values()].reduce((total, metric) => total + metric.writeBytes, 0);
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
        const aggregates = aggregateBlueprintIoWorkloadMetrics(metrics);
        lastDeficits = [
            ...requestCountDeficits(aggregates.worker, expectedWorkerRequestCounts),
            ...requestCountDeficits(aggregates.history, expectedHistoryRequestCounts),
        ];
        const completionCount = metrics.worker.length + metrics.history.length;
        if (lastDeficits.length === 0) {
            if (completionCount !== lastCompletionCount) {
                lastCompletionCount = completionCount;
                quiescentSince = Date.now();
            } else if (Date.now() - quiescentSince >= logDrainQuiescenceMs) {
                return;
            }
        } else {
            lastCompletionCount = completionCount;
            quiescentSince = 0;
        }
        await wait(logDrainPollMs);
    }
    throw new Error(
        `Convex metrics did not drain before timeout. Missing completions: ${lastDeficits.join(', ') || 'none; stream never became quiescent'}.`
    );
}

function requestCountDeficits(
    aggregates: ReadonlyMap<string, BlueprintIoAggregate>,
    expectedCounts: ReadonlyMap<string, number>
): string[] {
    return [...expectedCounts].flatMap(([functionName, expected]) => {
        const actual = aggregates.get(functionName)?.requests ?? 0;
        if (actual > expected) {
            throw new Error(`${functionName} executed ${String(actual)} times; expected ${String(expected)}.`);
        }
        return actual === expected ? [] : [`${functionName}: ${String(actual)}/${String(expected)}`];
    });
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
        if (record.kind !== 'Completion') return [];
        const metric = completionMetric(record);
        if (!metric) throw new Error('Convex completion could not be measured.');
        if (!allowedFunctions.has(metric.functionName)) {
            throw new Error(`Unexpected Convex function ${metric.functionName} completed during the ${phase} phase.`);
        }
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
    const convexSourceRoot = resolve(workspaceDirectory, 'convex');
    const summaryPath = resolve(convexSourceRoot, 'blueprint/blueprint_history_summaries.ts');
    const hotRecordsPath = resolve(convexSourceRoot, 'blueprint/blueprint_hot_records.ts');
    const summarySource = await readFile(summaryPath, 'utf8');
    const hotRecordsSource = await readFile(hotRecordsPath, 'utf8');
    const allowedSummaryImports = new Set([
        'convex/values',
        '../_generated/server.js',
        '../auth.js',
        './blueprint_hot_records.js',
    ]);
    const forbiddenSummaryImport = moduleSpecifiers(summarySource, summaryPath).find(
        (specifier) => !allowedSummaryImports.has(specifier)
    );
    if (forbiddenSummaryImport) {
        throw new Error(`Blueprint History summary module imports forbidden dependency ${forbiddenSummaryImport}.`);
    }
    const allowedHotRecordImports = new Set(['convex/values', '../_generated/dataModel.js']);
    const forbiddenHotRecordImport = moduleSpecifiers(hotRecordsSource, hotRecordsPath).find(
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
    await assertNoTransitiveColdDependencies(summaryPath, convexSourceRoot, historyColdTables);
}

export async function assertNoTransitiveColdDependencies(
    entryPath: string,
    sourceRoot: string,
    forbiddenTables: readonly string[] = historyColdTables
): Promise<void> {
    const normalizedRoot = resolve(sourceRoot);
    const visited = new Set<string>();
    const forbidden = new Set(forbiddenTables);

    async function visit(modulePath: string, chain: string[]): Promise<void> {
        const normalizedPath = resolve(modulePath);
        assertPathInsideSourceRoot(normalizedPath, normalizedRoot);
        if (visited.has(normalizedPath)) return;
        visited.add(normalizedPath);

        const source = await readFile(normalizedPath, 'utf8');
        const sourceFile = ts.createSourceFile(normalizedPath, source, ts.ScriptTarget.Latest, true);
        const coldTable = findStringLiteral(sourceFile, forbidden);
        if (coldTable) {
            const pathChain = [...chain, normalizedPath]
                .map((path) => relative(normalizedRoot, path).replaceAll('\\', '/'))
                .join(' -> ');
            throw new Error(`Blueprint History reaches forbidden cold table ${coldTable} through ${pathChain}.`);
        }

        for (const specifier of moduleSpecifiersFromSourceFile(sourceFile)) {
            if (!specifier.startsWith('.')) continue;
            if (isGeneratedConvexImport(normalizedPath, specifier, normalizedRoot)) continue;
            const dependency = await resolveTypeScriptModule(normalizedPath, specifier, normalizedRoot);
            await visit(dependency, [...chain, normalizedPath]);
        }
    }

    await visit(entryPath, []);
}

function moduleSpecifiers(source: string, fileName: string): string[] {
    return moduleSpecifiersFromSourceFile(ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true));
}

function moduleSpecifiersFromSourceFile(sourceFile: ts.SourceFile): string[] {
    const specifiers: string[] = [];
    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteralLike(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text);
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length === 1 &&
            node.arguments[0] &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            specifiers.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return specifiers;
}

function findStringLiteral(sourceFile: ts.SourceFile, forbidden: ReadonlySet<string>): string | undefined {
    let match: string | undefined;
    const visit = (node: ts.Node): void => {
        if (!match && ts.isStringLiteralLike(node) && forbidden.has(node.text)) match = node.text;
        if (!match) ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return match;
}

async function resolveTypeScriptModule(importer: string, specifier: string, sourceRoot: string): Promise<string> {
    const unresolved = resolve(dirname(importer), specifier);
    assertPathInsideSourceRoot(unresolved, sourceRoot);
    const candidates = /\.[cm]?js$/u.test(unresolved)
        ? [unresolved.replace(/\.[cm]?js$/u, '.ts'), unresolved.replace(/\.[cm]?js$/u, '.tsx')]
        : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, resolve(unresolved, 'index.ts')];
    for (const candidate of candidates) {
        try {
            await readFile(candidate, 'utf8');
            return candidate;
        } catch {
            // Try the next TypeScript source candidate.
        }
    }
    throw new Error(`Could not resolve relative History dependency ${specifier} imported by ${importer}.`);
}

function isGeneratedConvexImport(importer: string, specifier: string, sourceRoot: string): boolean {
    const unresolved = resolve(dirname(importer), specifier);
    const pathFromRoot = relative(sourceRoot, unresolved).replaceAll('\\', '/');
    return pathFromRoot === '_generated' || pathFromRoot.startsWith('_generated/');
}

function assertPathInsideSourceRoot(path: string, sourceRoot: string): void {
    const pathFromRoot = relative(sourceRoot, path);
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
        throw new Error(`Blueprint History dependency escapes the Convex source root: ${path}.`);
    }
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
