import { describe, expect, it } from 'vitest';

import { isBlueprintPreflightReportReady, normalizeBlueprintPreflightReport } from './preflight-report.js';

describe('normalizeBlueprintPreflightReport', () => {
    it('accepts a report whose summary matches its typed steps', () => {
        const report = {
            summary: {
                total: 2,
                ready: 1,
                stale: 0,
                mappingRequired: 0,
                destructiveApprovalRequired: 1,
                unsupported: 0,
                invalidPlan: 0,
            },
            steps: [
                {
                    planStepId: 'step-1',
                    actionType: 'create',
                    targetType: 'role',
                    status: 'ready',
                    message: 'Ready.',
                },
                {
                    planStepId: 'step-2',
                    actionType: 'delete',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    status: 'destructive-approval-required',
                    message: 'Approval required.',
                },
            ],
        };

        const normalized = normalizeBlueprintPreflightReport(report);
        expect(normalized).toEqual({ type: 'valid', value: report });
        if (normalized.type !== 'valid') throw new Error(normalized.message);
        expect(isBlueprintPreflightReportReady(normalized.value)).toBe(true);
    });

    it('rejects inconsistent summary counts and unknown statuses', () => {
        const report = {
            summary: {
                total: 1,
                ready: 1,
                stale: 0,
                mappingRequired: 0,
                destructiveApprovalRequired: 0,
                unsupported: 0,
                invalidPlan: 0,
            },
            steps: [
                {
                    planStepId: 'step-1',
                    actionType: 'create',
                    targetType: 'role',
                    status: 'unexpected',
                    message: 'Unknown.',
                },
            ],
        };

        expect(normalizeBlueprintPreflightReport(report)).toMatchObject({ type: 'invalid' });
        expect(
            normalizeBlueprintPreflightReport({
                ...report,
                steps: [{ ...report.steps[0], status: 'ready' }],
                summary: { ...report.summary, ready: 0 },
            })
        ).toMatchObject({ type: 'invalid' });
    });

    it('never treats a report with hard blockers as ready', () => {
        const report = normalizeBlueprintPreflightReport({
            summary: {
                total: 1,
                ready: 0,
                stale: 1,
                mappingRequired: 0,
                destructiveApprovalRequired: 0,
                unsupported: 0,
                invalidPlan: 0,
            },
            steps: [
                {
                    planStepId: 'step-1',
                    actionType: 'update',
                    targetType: 'role',
                    status: 'stale',
                    message: 'The live target changed.',
                },
            ],
        });

        if (report.type !== 'valid') throw new Error(report.message);
        expect(isBlueprintPreflightReportReady(report.value)).toBe(false);
    });
});
