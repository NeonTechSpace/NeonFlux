/** @vitest-environment jsdom */
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import { emptyDashboardBlueprintConfirmation } from './dashboard-blueprint-deploy-readiness.js';
import { DashboardBlueprintDeployReview } from './dashboard-blueprint-deploy-review.js';
import type { DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';

afterEach(cleanup);

describe('DashboardBlueprintDeployReview confirmation', () => {
    it('keeps human-readable destructive requirements in Confirm content', () => {
        const onConfirmationChange = vi.fn();
        render(
            <DashboardBlueprintDeployReview
                busyAction={undefined}
                confirmation={emptyDashboardBlueprintConfirmation}
                journeyStep='confirm'
                onConfirmationChange={onConfirmationChange}
                onLoadPlanSteps={() => undefined}
                plan={createPlan({ policy: 'rebuild', deleteStepCount: 2 })}
                preflightReport={createDestructivePreflight()}
                targetGuildName='Guild One'
            />
        );

        fireEvent.click(screen.getByRole('checkbox', { name: /2 existing objects will be removed/u }));
        expect(onConfirmationChange).toHaveBeenCalledWith({
            ...emptyDashboardBlueprintConfirmation,
            understandsDeletion: true,
        });
        expect(screen.getByRole('checkbox', { name: /create a restore point before mutation/u })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Target server name confirmation' })).toBeTruthy();
        expect(screen.queryByText(/delete-digest/u)).toBeNull();
    });

    it('does not request text or checkboxes for a non-destructive plan', () => {
        render(
            <DashboardBlueprintDeployReview
                busyAction={undefined}
                journeyStep='confirm'
                onConfirmationChange={vi.fn()}
                onLoadPlanSteps={() => undefined}
                plan={createPlan({ policy: 'merge', deleteStepCount: 0 })}
                preflightReport={undefined}
                targetGuildName='Guild One'
            />
        );

        expect(screen.getByText('No destructive confirmation required')).toBeTruthy();
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.queryByRole('textbox')).toBeNull();
    });
});

function createDestructivePreflight(): DashboardBlueprintPreflightView {
    return {
        checkedAt: '2026-07-15T10:00:00.000Z',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        summary: {
            total: 2,
            ready: 0,
            stale: 0,
            mappingRequired: 0,
            destructiveApprovalRequired: 2,
            unsupported: 0,
            invalidPlan: 0,
        },
        steps: [0, 1].map((index) => ({
            planStepId: `delete-${index}`,
            actionType: 'delete',
            targetType: 'channel',
            status: 'destructive-approval-required' as const,
            message: 'Requires confirmation.',
        })),
    };
}

function createPlan({
    policy,
    deleteStepCount,
}: Pick<DashboardBlueprintPlan, 'policy' | 'deleteStepCount'>): DashboardBlueprintPlan {
    return {
        id: 'plan-1',
        status: 'approved',
        createdAt: '2026-07-15T10:00:00.000Z',
        updatedAt: '2026-07-15T10:00:00.000Z',
        summary: { creates: 1, updates: 0, deletes: deleteStepCount, roles: 1, categories: 0, channels: 0 },
        changeCount: 1 + deleteStepCount,
        planStepCount: 1 + deleteStepCount,
        planBlockerCount: 0,
        steps: [],
        policy,
        decisionSummary: {
            'no-op': 0,
            create: 1,
            update: 0,
            delete: deleteStepCount,
            'unmanaged-retained': 0,
            'protected-retained': 0,
            'protected-omitted': 0,
            'blocked-ambiguous': 0,
            'blocked-unsupported': 0,
        },
        decisions: [],
        planDigest: 'plan-digest',
        deleteStepCount,
        ...(deleteStepCount > 0 ? { deleteSetDigest: 'delete-digest' } : {}),
    };
}
