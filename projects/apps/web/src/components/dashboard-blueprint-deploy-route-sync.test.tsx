// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useDashboardBlueprintDeployRouteSync } from './dashboard-blueprint-deploy-route-sync.js';
import type { DashboardBlueprintDeployJourneyStep } from './dashboard-blueprint-deploy-stage.js';

type TestPlan = {
    id: string;
};

type HarnessProps = {
    initialPlanId: string;
    initialStep: DashboardBlueprintDeployJourneyStep;
    requestedPlan: TestPlan;
    requestedStep: DashboardBlueprintDeployJourneyStep;
    onSelectRequestedPlan: (plan: TestPlan) => void;
    onReplaceRoute: (planId: string | undefined, step: DashboardBlueprintDeployJourneyStep) => void;
};

function useRouteSyncHarness({
    initialPlanId,
    initialStep,
    requestedPlan,
    requestedStep,
    onSelectRequestedPlan,
    onReplaceRoute,
}: HarnessProps) {
    const [selection, setSelection] = useState({ planId: initialPlanId, step: initialStep });
    const selectRequestedPlan = useCallback(
        (plan: TestPlan) => {
            onSelectRequestedPlan(plan);
            setSelection((current) => ({ ...current, planId: plan.id }));
        },
        [onSelectRequestedPlan]
    );
    useDashboardBlueprintDeployRouteSync({
        guildId: 'guild-1',
        ready: true,
        requestedPlanId: requestedPlan.id,
        requestedStep,
        requestedPlan,
        requestedPlanMissing: false,
        selectedPlanId: selection.planId,
        selectedStep: selection.step,
        onSelectRequestedPlan: selectRequestedPlan,
        onReplaceRoute,
    });

    return {
        selection,
        selectLocalPlan: (planId: string, step: DashboardBlueprintDeployJourneyStep) => setSelection({ planId, step }),
    };
}

describe('useDashboardBlueprintDeployRouteSync', () => {
    it('replaces the route once when a recovery plan becomes the local selection', async () => {
        const planA = { id: 'plan-a' };
        const planB = { id: 'plan-b' };
        const onSelectRequestedPlan = vi.fn();
        const onReplaceRoute = vi.fn();
        const { result, rerender } = renderHook(useRouteSyncHarness, {
            initialProps: {
                initialPlanId: planA.id,
                initialStep: 'deploy',
                requestedPlan: planA,
                requestedStep: 'deploy',
                onSelectRequestedPlan,
                onReplaceRoute,
            },
        });

        act(() => result.current.selectLocalPlan(planB.id, 'review'));
        await waitFor(() => expect(onReplaceRoute).toHaveBeenCalledWith(planB.id, 'review'));

        rerender({
            initialPlanId: planA.id,
            initialStep: 'deploy',
            requestedPlan: planA,
            requestedStep: 'deploy',
            onSelectRequestedPlan,
            onReplaceRoute,
        });
        expect(result.current.selection).toEqual({ planId: planB.id, step: 'review' });
        expect(onSelectRequestedPlan).not.toHaveBeenCalled();
        expect(onReplaceRoute).toHaveBeenCalledTimes(1);

        rerender({
            initialPlanId: planA.id,
            initialStep: 'deploy',
            requestedPlan: planB,
            requestedStep: 'review',
            onSelectRequestedPlan,
            onReplaceRoute,
        });
        rerender({
            initialPlanId: planA.id,
            initialStep: 'deploy',
            requestedPlan: planB,
            requestedStep: 'review',
            onSelectRequestedPlan,
            onReplaceRoute,
        });

        expect(result.current.selection).toEqual({ planId: planB.id, step: 'review' });
        expect(onSelectRequestedPlan).not.toHaveBeenCalled();
        expect(onReplaceRoute).toHaveBeenCalledTimes(1);
    });

    it('consumes browser plan navigation without writing the previous plan back to the route', () => {
        const planA = { id: 'plan-a' };
        const planB = { id: 'plan-b' };
        const onSelectRequestedPlan = vi.fn();
        const onReplaceRoute = vi.fn();
        const { result, rerender } = renderHook(useRouteSyncHarness, {
            initialProps: {
                initialPlanId: planB.id,
                initialStep: 'review',
                requestedPlan: planB,
                requestedStep: 'review',
                onSelectRequestedPlan,
                onReplaceRoute,
            },
        });

        rerender({
            initialPlanId: planB.id,
            initialStep: 'review',
            requestedPlan: planA,
            requestedStep: 'review',
            onSelectRequestedPlan,
            onReplaceRoute,
        });
        expect(result.current.selection).toEqual({ planId: planA.id, step: 'review' });
        expect(onSelectRequestedPlan).toHaveBeenCalledExactlyOnceWith(planA);
        expect(onReplaceRoute).not.toHaveBeenCalled();
    });

    it('writes each canonical step transition once without regressing the route', async () => {
        const plan = { id: 'plan-a' };
        const onSelectRequestedPlan = vi.fn();
        const onReplaceRoute = vi.fn();
        const { result, rerender } = renderHook(useRouteSyncHarness, {
            initialProps: {
                initialPlanId: plan.id,
                initialStep: 'review',
                requestedPlan: plan,
                requestedStep: 'review',
                onSelectRequestedPlan,
                onReplaceRoute,
            },
        });

        act(() => result.current.selectLocalPlan(plan.id, 'safety'));
        await waitFor(() => expect(onReplaceRoute).toHaveBeenCalledWith(plan.id, 'safety'));
        rerender({
            initialPlanId: plan.id,
            initialStep: 'review',
            requestedPlan: plan,
            requestedStep: 'safety',
            onSelectRequestedPlan,
            onReplaceRoute,
        });
        act(() => result.current.selectLocalPlan(plan.id, 'confirm'));
        await waitFor(() => expect(onReplaceRoute).toHaveBeenCalledWith(plan.id, 'confirm'));
        rerender({
            initialPlanId: plan.id,
            initialStep: 'review',
            requestedPlan: plan,
            requestedStep: 'confirm',
            onSelectRequestedPlan,
            onReplaceRoute,
        });
        expect(onReplaceRoute.mock.calls).toEqual([
            [plan.id, 'safety'],
            [plan.id, 'confirm'],
        ]);
        expect(onSelectRequestedPlan).not.toHaveBeenCalled();
    });
});
