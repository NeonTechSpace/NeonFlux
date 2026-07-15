import { describe, expect, it } from 'vitest';

import {
    aggregateBlueprintIoMetrics,
    assertBlueprintIoAcceptance,
    extractBlueprintIoWorkloadMetrics,
    parseBlueprintIoMetrics,
} from './blueprint-io-acceptance.js';

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

    it('measures only explicit workload phases and rejects unknown Blueprint calls inside them', () => {
        const markers = {
            workerStart: 'worker-start-test',
            workerEnd: 'worker-end-test',
            historyStart: 'history-start-test',
            historyEnd: 'history-end-test',
        };
        const records = [
            log('blueprint:createBlueprintPlanDraft', 900_000, 1),
            markerLog(markers.workerStart),
            log('blueprint:claimNextBlueprintRun', 12, 5),
            markerLog(markers.workerEnd),
            log('blueprint:createBlueprintPlanDraft', 900_000, 1),
            markerLog(markers.historyStart),
            log('blueprint:listBlueprintPlanSummariesByGuildId', 6, 0),
            markerLog(markers.historyEnd),
        ];
        expect(
            extractBlueprintIoWorkloadMetrics(records.map((record) => JSON.stringify(record)).join('\n'), markers)
        ).toStrictEqual([
            { functionName: 'blueprint:claimNextBlueprintRun', readBytes: 12, writeBytes: 5 },
            { functionName: 'blueprint:listBlueprintPlanSummariesByGuildId', readBytes: 6, writeBytes: 0 },
        ]);

        records.splice(3, 0, log('blueprint:getBlueprintPlanAuthority', 700 * 1024, 0));
        expect(() =>
            extractBlueprintIoWorkloadMetrics(records.map((record) => JSON.stringify(record)).join('\n'), markers)
        ).toThrow(/Unexpected Blueprint function blueprint:getBlueprintPlanAuthority.*worker phase/u);
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
        const aggregates = aggregateBlueprintIoMetrics(metrics);
        expect(() => assertBlueprintIoAcceptance(aggregates)).not.toThrow();
        expect(aggregates.get('blueprint:completeAndCheckpointBlueprintRunStepAttempt')).toMatchObject({
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
        expect(() => assertBlueprintIoAcceptance(aggregateBlueprintIoMetrics(oversized))).toThrow(/maximum is 64 KiB/u);
        const missingStart = [...valid];
        missingStart.splice(2 + 475, 1);
        expect(() => assertBlueprintIoAcceptance(aggregateBlueprintIoMetrics(missingStart))).toThrow(
            /executed 474 times/u
        );
        const oversizedWrite = valid.map((metric) =>
            metric.functionName === 'blueprint:prepareBlueprintRunStepAttempt'
                ? { ...metric, writeBytes: 64 * 1024 + 1 }
                : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateBlueprintIoMetrics(oversizedWrite))).toThrow(
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
        expect(() => assertBlueprintIoAcceptance(aggregateBlueprintIoMetrics(historyWrite))).toThrow(
            /History wrote 1 bytes/u
        );
        const workerWrite = valid.map((metric) =>
            metric.functionName === 'blueprint:claimNextBlueprintRun'
                ? { ...metric, writeBytes: 32 * 1024 * 1024 + 1 }
                : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateBlueprintIoMetrics(workerWrite))).toThrow(/worker wrote/u);
    });

    it('rejects standalone renewals, an oversized reclaim, and excessive total reads', () => {
        const valid = validMetrics();
        expect(() =>
            assertBlueprintIoAcceptance(
                aggregateBlueprintIoMetrics([
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
        expect(() => assertBlueprintIoAcceptance(aggregateBlueprintIoMetrics(oversizedClaim))).toThrow(
            /reclaim claim read/u
        );

        const excessiveReads = valid.map((metric) =>
            metric.functionName === 'blueprint:completeAndCheckpointBlueprintRunStepAttempt'
                ? { ...metric, readBytes: 64 * 1024 }
                : metric
        );
        expect(() => assertBlueprintIoAcceptance(aggregateBlueprintIoMetrics(excessiveReads))).not.toThrow();
        const firstExcessiveRead = excessiveReads[0];
        if (!firstExcessiveRead) {
            throw new Error('Expected at least one Blueprint I/O metric.');
        }
        excessiveReads[0] = { ...firstExcessiveRead, readBytes: 4 * 1024 * 1024 };
        expect(() => assertBlueprintIoAcceptance(aggregateBlueprintIoMetrics(excessiveReads))).toThrow(/worker read/u);
    });

    it('rejects an unlisted measured Blueprint function', () => {
        expect(() =>
            assertBlueprintIoAcceptance(
                aggregateBlueprintIoMetrics([
                    ...validMetrics(),
                    { functionName: 'blueprint:getBlueprintPlanAuthority', readBytes: 700 * 1024, writeBytes: 0 },
                ])
            )
        ).toThrow(/unexpected measured function blueprint:getBlueprintPlanAuthority/u);
    });
});

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
