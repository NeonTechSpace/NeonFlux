import { describe, expect, it } from 'vitest';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import {
    canStartNewBlueprintDeployment,
    getDashboardBlueprintDeployStage,
} from './dashboard-blueprint-deploy-stage.js';

describe('getDashboardBlueprintDeployStage', () => {
    it.each(['draft', 'needs_input', 'review_ready'] as const)('keeps a %s plan in review', (status) => {
        expect(getDashboardBlueprintDeployStage({ status } as DashboardBlueprintPlan)).toBe(2);
    });

    it('treats a run as authoritative over an older plan status', () => {
        const run = {
            status: 'approved',
            run: {
                id: 'run-1',
                protocolVersion: 1,
                status: 'queued',
                phase: 'queued',
                completedSteps: 0,
                failedSteps: 0,
                totalSteps: 4,
                createdAt: '2026-07-12T10:00:00.000Z',
                updatedAt: '2026-07-12T10:00:00.000Z',
            },
        } as DashboardBlueprintPlan;

        expect(getDashboardBlueprintDeployStage(run)).toBe(3);
    });

    it.each(['queued', 'running', 'paused', 'partially_applied', 'needs_reconciliation', 'outcome_unknown'] as const)(
        'does not allow a new source while a run is %s',
        (status) => {
            const run = {
                run: { status },
            } as DashboardBlueprintPlan;

            expect(canStartNewBlueprintDeployment(run)).toBe(false);
        }
    );

    it.each(['succeeded', 'failed_before_mutation', 'cancelled'] as const)(
        'allows a new source after a run is %s',
        (status) => {
            const run = {
                run: { status },
            } as DashboardBlueprintPlan;

            expect(canStartNewBlueprintDeployment(run)).toBe(true);
        }
    );
});
