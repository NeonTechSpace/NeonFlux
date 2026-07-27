import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    aggregateBlueprintIoWorkloadMetrics,
    assertBlueprintIoAcceptance,
    extractBlueprintIoWorkloadMetrics,
    parseBlueprintIoMetrics,
} from './blueprint-io-acceptance.js';
import { assertTypeScriptDependencyBoundary, isGeneratedConvexImport } from './typescript-dependency-boundary.js';

const historyColdTables = [
    'blueprintPlanAuthorities',
    'blueprintPlanAuthorityChunks',
    'blueprintPlanExecutionAuthorities',
    'blueprintPlanExecutionAuthorityBuckets',
    'blueprintPlanPreflightEvidence',
    'blueprintPlanSteps',
    'blueprintPlanDecisions',
    'blueprintRunCursors',
    'blueprintRunVerificationEvidence',
    'blueprintRunIdMappings',
] as const;

describe('Blueprint I/O acceptance metrics', () => {
    it('parses successful completions, ignores progress, and rejects malformed, failed, or retried logs', () => {
        const completion = log('blueprint:checkpointBlueprintRun', 12, 5);
        const source = [JSON.stringify(completion), JSON.stringify({ ...completion, kind: 'Progress' })].join('\n');
        expect(parseBlueprintIoMetrics(source)).toStrictEqual([
            { functionName: 'blueprint:checkpointBlueprintRun', readBytes: 12, writeBytes: 5 },
        ]);
        expect(() => parseBlueprintIoMetrics(JSON.stringify({ ...completion, error: 'failed' }))).toThrow(
            /unexpected error/u
        );
        expect(() => parseBlueprintIoMetrics(JSON.stringify({ ...completion, willRetry: true }))).toThrow(
            /unexpected retry/u
        );
        expect(() => parseBlueprintIoMetrics('not-json')).toThrow(/malformed or truncated/u);
    });

    it('measures only explicit workload phases and rejects every unknown call inside them', () => {
        const markers = {
            setupStart: 'setup-start-test',
            setupEnd: 'setup-end-test',
            workerStart: 'worker-start-test',
            workerEnd: 'worker-end-test',
            historyStart: 'history-start-test',
            historyEnd: 'history-end-test',
        };
        const records: Array<Record<string, unknown>> = [
            log('blueprint:createBlueprintPlanDraft', 900_000, 1),
            markerLog(markers.setupStart),
            log('blueprint:createStructureBackup', 12, 5),
            markerLog(markers.setupEnd),
            markerLog(markers.workerStart),
            log('blueprint:claimNextBlueprintRun', 12, 5),
            markerLog(markers.workerEnd),
            log('blueprint:createBlueprintPlanDraft', 900_000, 1),
            markerLog(markers.historyStart),
            log('auth_store:findActiveWebSessionById', 2, 0),
            log('blueprint:listBlueprintPlanSummariesByGuildId', 6, 0),
            markerLog(markers.historyEnd),
        ];
        expect(
            extractBlueprintIoWorkloadMetrics(records.map((record) => JSON.stringify(record)).join('\n'), markers)
        ).toStrictEqual({
            setup: [{ functionName: 'blueprint:createStructureBackup', readBytes: 12, writeBytes: 5 }],
            worker: [{ functionName: 'blueprint:claimNextBlueprintRun', readBytes: 12, writeBytes: 5 }],
            history: [
                { functionName: 'auth_store:findActiveWebSessionById', readBytes: 2, writeBytes: 0 },
                { functionName: 'blueprint:listBlueprintPlanSummariesByGuildId', readBytes: 6, writeBytes: 0 },
            ],
        });

        records.splice(6, 0, log('blueprint:getBlueprintPlanAuthority', 700 * 1024, 0));
        expect(() =>
            extractBlueprintIoWorkloadMetrics(records.map((record) => JSON.stringify(record)).join('\n'), markers)
        ).toThrow(/Unexpected Convex function blueprint:getBlueprintPlanAuthority.*worker phase/u);

        records.splice(6, 1, log('runtime:getRuntimeContract', 1, 0));
        expect(() =>
            extractBlueprintIoWorkloadMetrics(records.map((record) => JSON.stringify(record)).join('\n'), markers)
        ).toThrow(/Unexpected Convex function runtime:getRuntimeContract.*worker phase/u);

        records.splice(6, 1);
        records.splice(-1, 0, log('runtime:getRuntimeContract', 1, 0));
        expect(() =>
            extractBlueprintIoWorkloadMetrics(records.map((record) => JSON.stringify(record)).join('\n'), markers)
        ).toThrow(/Unexpected Convex function runtime:getRuntimeContract.*History phase/u);

        records.splice(-2, 1, {
            ...log('blueprint:listBlueprintPlanSummariesByGuildId', 1, 0),
            usageStats: undefined,
        });
        expect(() =>
            extractBlueprintIoWorkloadMetrics(records.map((record) => JSON.stringify(record)).join('\n'), markers)
        ).toThrow(/omitted its identifier or usage metrics/u);
    });

    it('aggregates bytes and enforces the expected request and byte budgets', () => {
        const metrics = [
            ...repeat('blueprint:claimNextBlueprintRun', 2, 1),
            ...repeat('blueprint:authorizeBlueprintRunMutation', 1, 1),
            ...repeat('blueprint:ensureBlueprintRunRestorePoint', 1, 1),
            ...repeat('blueprint:prepareBlueprintRunStepAttempt', 475, 1),
            ...repeat('blueprint:startBlueprintRunStepAttempt', 475, 1),
            ...repeat('blueprint:completeAndCheckpointBlueprintRunStepAttempt', 475, 100),
            ...repeat('blueprint:checkpointBlueprintRun', 1, 1),
            ...repeat('blueprint:finalizeBlueprintRun', 1, 1),
            ...repeat('blueprint:listBlueprintPlanSummariesByGuildId', 1, 1),
            ...repeat('blueprint:listLatestBlueprintPlanPreflightSummaries', 1, 1),
            ...repeat('blueprint:listLatestBlueprintRunSummaries', 1, 1),
        ];
        const aggregates = aggregateAcceptanceMetrics(metrics);
        expect(() => assertBlueprintIoAcceptance(aggregates)).not.toThrow();
        expect(aggregates.worker.get('blueprint:completeAndCheckpointBlueprintRunStepAttempt')).toMatchObject({
            maximumReadBytes: 100,
            maximumWriteBytes: 0,
            readBytes: 47_500,
            requests: 475,
        });
    });

    it('fails when a normal step uses an unexpected request count or exceeds a read or write budget', () => {
        const valid = [
            ...repeat('blueprint:claimNextBlueprintRun', 2, 1),
            ...repeat('blueprint:authorizeBlueprintRunMutation', 1, 1),
            ...repeat('blueprint:ensureBlueprintRunRestorePoint', 1, 1),
            ...repeat('blueprint:prepareBlueprintRunStepAttempt', 475, 1),
            ...repeat('blueprint:startBlueprintRunStepAttempt', 475, 1),
            ...repeat('blueprint:completeAndCheckpointBlueprintRunStepAttempt', 475, 1),
            ...repeat('blueprint:checkpointBlueprintRun', 1, 1),
            ...repeat('blueprint:finalizeBlueprintRun', 1, 1),
            ...repeat('blueprint:listBlueprintPlanSummariesByGuildId', 1, 1),
            ...repeat('blueprint:listLatestBlueprintPlanPreflightSummaries', 1, 1),
            ...repeat('blueprint:listLatestBlueprintRunSummaries', 1, 1),
        ];
        const oversized = valid.map((metric) =>
            metric.functionName === 'blueprint:completeAndCheckpointBlueprintRunStepAttempt'
                ? { ...metric, readBytes: 64 * 1024 + 1 }
                : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateAcceptanceMetrics(oversized))).toThrow(/maximum is 64 KiB/u);
        const missingStart = [...valid];
        missingStart.splice(2 + 475, 1);
        expect(() => assertBlueprintIoAcceptance(aggregateAcceptanceMetrics(missingStart))).toThrow(
            /executed 474 times/u
        );
        const oversizedWrite = valid.map((metric) =>
            metric.functionName === 'blueprint:prepareBlueprintRunStepAttempt'
                ? { ...metric, writeBytes: 64 * 1024 + 1 }
                : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateAcceptanceMetrics(oversizedWrite))).toThrow(
            /maximum is 64 KiB/u
        );
    });

    it('rejects History writes and excessive aggregate worker writes', () => {
        const valid = [
            ...repeat('blueprint:claimNextBlueprintRun', 2, 1),
            ...repeat('blueprint:authorizeBlueprintRunMutation', 1, 1),
            ...repeat('blueprint:ensureBlueprintRunRestorePoint', 1, 1),
            ...repeat('blueprint:prepareBlueprintRunStepAttempt', 475, 1),
            ...repeat('blueprint:startBlueprintRunStepAttempt', 475, 1),
            ...repeat('blueprint:completeAndCheckpointBlueprintRunStepAttempt', 475, 1),
            ...repeat('blueprint:checkpointBlueprintRun', 1, 1),
            ...repeat('blueprint:finalizeBlueprintRun', 1, 1),
            ...repeat('blueprint:listBlueprintPlanSummariesByGuildId', 1, 1),
            ...repeat('blueprint:listLatestBlueprintPlanPreflightSummaries', 1, 1),
            ...repeat('blueprint:listLatestBlueprintRunSummaries', 1, 1),
        ];
        const historyWrite = valid.map((metric) =>
            metric.functionName === 'blueprint:listLatestBlueprintRunSummaries' ? { ...metric, writeBytes: 1 } : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateAcceptanceMetrics(historyWrite))).toThrow(
            /History wrote 1 bytes/u
        );
        const workerWrite = valid.map((metric) =>
            metric.functionName === 'blueprint:claimNextBlueprintRun'
                ? { ...metric, writeBytes: 32 * 1024 * 1024 + 1 }
                : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateAcceptanceMetrics(workerWrite))).toThrow(
            /8 MiB per-function/u
        );
    });

    it('rejects standalone renewals, an oversized reclaim, and excessive total reads', () => {
        const valid = validMetrics();
        expect(() =>
            assertBlueprintIoAcceptance(
                aggregateAcceptanceMetrics([
                    ...valid,
                    { functionName: 'blueprint:renewBlueprintRunLease', readBytes: 1, writeBytes: 1 },
                ])
            )
        ).toThrow(/renewBlueprintRunLease executed 1 times/u);

        const oversizedClaim = valid.map((metric, index) =>
            metric.functionName === 'blueprint:claimNextBlueprintRun' && index === 0
                ? { ...metric, readBytes: 4 * 1024 * 1024 + 1 }
                : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateAcceptanceMetrics(oversizedClaim))).toThrow(
            /reclaim claim read/u
        );

        const excessiveReads = valid.map((metric) =>
            metric.functionName === 'blueprint:completeAndCheckpointBlueprintRunStepAttempt'
                ? { ...metric, readBytes: 64 * 1024 }
                : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateAcceptanceMetrics(excessiveReads))).not.toThrow();
        const firstExcessiveRead = excessiveReads[0];
        if (!firstExcessiveRead) {
            throw new Error('Expected at least one Blueprint I/O metric.');
        }
        excessiveReads[0] = { ...firstExcessiveRead, readBytes: 4 * 1024 * 1024 };
        expect(() => assertBlueprintIoAcceptance(aggregateAcceptanceMetrics(excessiveReads))).toThrow(
            /worker combined/u
        );
    });

    it('rejects an unlisted measured Blueprint function', () => {
        expect(() =>
            assertBlueprintIoAcceptance(
                aggregateBlueprintIoWorkloadMetrics({
                    history: historyMetrics(),
                    setup: defaultSetupMetrics(),
                    worker: [
                        ...validMetrics(),
                        { functionName: 'blueprint:getBlueprintPlanAuthority', readBytes: 700 * 1024, writeBytes: 0 },
                    ].filter((metric) => !isHistoryMetric(metric)),
                })
            )
        ).toThrow(/Unexpected Convex function blueprint:getBlueprintPlanAuthority.*worker phase/u);
    });

    it('rejects cold tables reached directly or through an indirect History import', async () => {
        const root = await mkdtemp(join(tmpdir(), 'neonflux-history-boundary-'));
        try {
            const entry = join(root, 'history.ts');
            const direct = join(root, 'direct.ts');
            await writeFile(entry, "export { load } from './helper.js';\n", 'utf8');
            await writeFile(join(root, 'helper.ts'), "export { load } from './cold.js';\n", 'utf8');
            await writeFile(
                join(root, 'cold.ts'),
                "export const load = (ctx: any) => ctx.db.query('blueprintPlanAuthorities');\n",
                'utf8'
            );
            await writeFile(direct, "export const table = 'blueprintPlanSteps';\n", 'utf8');

            for (const [entryPath, expectedPath] of [
                [entry, /history\.ts -> helper\.ts -> cold\.ts/u],
                [direct, /direct\.ts/u],
            ] as const) {
                await expect(
                    assertTypeScriptDependencyBoundary({
                        entryPath,
                        forbiddenStringLiterals: historyColdTables,
                        label: 'Fixture History boundary',
                        sourceRoot: root,
                    })
                ).rejects.toThrow(expectedPath);
            }
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('accepts the current transitive History dependency graph', async () => {
        const root = join(process.cwd(), 'convex');
        await expect(
            assertTypeScriptDependencyBoundary({
                entryPath: join(root, 'blueprint/blueprint_history_summaries.ts'),
                forbiddenStringLiterals: historyColdTables,
                ignoreRelativeImport: isGeneratedConvexImport,
                label: 'Blueprint History summary',
                sourceRoot: root,
            })
        ).resolves.toBeUndefined();
    });
});

function aggregateAcceptanceMetrics(metrics: ReadonlyArray<ReturnType<typeof repeat>[number]>) {
    return aggregateBlueprintIoWorkloadMetrics({
        history: metrics.filter(isHistoryMetric),
        setup: [...defaultSetupMetrics(), ...metrics.filter(isSetupMetric)],
        worker: metrics.filter((metric) => !isHistoryMetric(metric) && !isSetupMetric(metric)),
    });
}

const setupFunctionNames = new Set([
    'blueprint:createBlueprintPlanDraft',
    'blueprint:createStructureBackup',
    'blueprint:finalizeBlueprintPlan',
    'blueprint:findLatestStructureDriftBaselineBackupByGuildId',
    'blueprint:findStructureBackupByGuildId',
    'blueprint:getBlueprintPlanAuthority',
    'blueprint:getBlueprintPlanMetadata',
    'blueprint:listBlueprintPlanDecisionsPage',
    'blueprint:listBlueprintPlanStepsByPlanIdPage',
    'blueprint:listStructureBackupSummaryPageByGuildId',
    'blueprint:pruneExpiredStructureBackupsForGuild',
    'blueprint:recordBlueprintPlanPreflight',
    'blueprint:writeBlueprintPlanDecisionBatch',
    'blueprint:writeBlueprintPlanStepBatch',
]);

function isSetupMetric(metric: { functionName: string }): boolean {
    return setupFunctionNames.has(metric.functionName);
}

function defaultSetupMetrics() {
    return [
        ...repeat('blueprint:createStructureBackup', 50, 1),
        ...repeat('blueprint:listStructureBackupSummaryPageByGuildId', 1, 1),
        ...repeat('blueprint:findStructureBackupByGuildId', 1, 1),
        ...repeat('blueprint:findLatestStructureDriftBaselineBackupByGuildId', 1, 1),
        ...repeat('blueprint:pruneExpiredStructureBackupsForGuild', 2, 1),
        ...repeat('blueprint:createBlueprintPlanDraft', 1, 1),
        ...repeat('blueprint:writeBlueprintPlanDecisionBatch', 5, 1),
        ...repeat('blueprint:writeBlueprintPlanStepBatch', 5, 1),
        ...repeat('blueprint:finalizeBlueprintPlan', 1, 1),
        ...repeat('blueprint:getBlueprintPlanMetadata', 1, 1),
        ...repeat('blueprint:getBlueprintPlanAuthority', 2, 1),
        ...repeat('blueprint:listBlueprintPlanStepsByPlanIdPage', 5, 1),
        ...repeat('blueprint:listBlueprintPlanDecisionsPage', 5, 1),
        ...repeat('blueprint:recordBlueprintPlanPreflight', 1, 1),
    ];
}

function isHistoryMetric(metric: { functionName: string }): boolean {
    return new Set([
        'blueprint:listBlueprintPlanSummariesByGuildId',
        'blueprint:listLatestBlueprintPlanPreflightSummaries',
        'blueprint:listLatestBlueprintRunSummaries',
    ]).has(metric.functionName);
}

function historyMetrics() {
    return validMetrics().filter(isHistoryMetric);
}

function validMetrics() {
    return [
        ...repeat('blueprint:claimNextBlueprintRun', 2, 1),
        ...repeat('blueprint:authorizeBlueprintRunMutation', 1, 1),
        ...repeat('blueprint:ensureBlueprintRunRestorePoint', 1, 1),
        ...repeat('blueprint:prepareBlueprintRunStepAttempt', 475, 1),
        ...repeat('blueprint:startBlueprintRunStepAttempt', 475, 1),
        ...repeat('blueprint:completeAndCheckpointBlueprintRunStepAttempt', 475, 1),
        ...repeat('blueprint:checkpointBlueprintRun', 1, 1),
        ...repeat('blueprint:finalizeBlueprintRun', 1, 1),
        ...repeat('blueprint:listBlueprintPlanSummariesByGuildId', 1, 1),
        ...repeat('blueprint:listLatestBlueprintPlanPreflightSummaries', 1, 1),
        ...repeat('blueprint:listLatestBlueprintRunSummaries', 1, 1),
    ];
}

function log(identifier: string, databaseIoReadBytes: number, databaseIoWriteBytes: number) {
    return {
        error: null,
        identifier,
        kind: 'Completion',
        usageStats: { databaseIoReadBytes, databaseIoWriteBytes },
        willRetry: false,
    };
}

function markerLog(marker: string) {
    return {
        ...log('runtime:blueprintIoAcceptanceMarker', 0, 0),
        logLines: [`[INFO] NEONFLUX_BLUEPRINT_IO_MARKER ${marker}`],
    };
}

function repeat(functionName: string, count: number, readBytes: number) {
    return Array.from({ length: count }, () => ({ functionName, readBytes, writeBytes: 0 }));
}
