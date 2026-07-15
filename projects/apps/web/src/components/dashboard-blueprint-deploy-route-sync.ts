import { useEffect, useRef } from 'react';

import type { DashboardBlueprintDeployJourneyStep } from './dashboard-blueprint-deploy-stage.js';

type DashboardBlueprintDeployRoutePlan = {
    id: string;
};

type DashboardBlueprintDeployRouteSyncInput<TPlan extends DashboardBlueprintDeployRoutePlan> = {
    guildId: string;
    ready: boolean;
    requestedPlanId?: string;
    requestedStep?: DashboardBlueprintDeployJourneyStep;
    requestedPlan?: TPlan;
    requestedPlanMissing: boolean;
    selectedPlanId?: string;
    selectedStep: DashboardBlueprintDeployJourneyStep;
    onSelectRequestedPlan: (plan: TPlan) => void;
    onReplaceRoute: (planId: string | undefined, step: DashboardBlueprintDeployJourneyStep) => void;
};

export function useDashboardBlueprintDeployRouteSync<TPlan extends DashboardBlueprintDeployRoutePlan>({
    guildId,
    ready,
    requestedPlanId,
    requestedStep,
    requestedPlan,
    requestedPlanMissing,
    selectedPlanId,
    selectedStep,
    onSelectRequestedPlan,
    onReplaceRoute,
}: DashboardBlueprintDeployRouteSyncInput<TPlan>): void {
    const routeSelectionKey = `${guildId}\0${requestedPlanId ?? ''}`;
    const observedRouteSelectionKeyRef = useRef<string | undefined>(undefined);
    const lastRouteReplacementKeyRef = useRef<string | undefined>(undefined);

    useEffect(() => {
        if (!ready) return;

        const routeSelectionChanged = observedRouteSelectionKeyRef.current !== routeSelectionKey;
        if (routeSelectionChanged) {
            observedRouteSelectionKeyRef.current = routeSelectionKey;
            lastRouteReplacementKeyRef.current = undefined;
            if (requestedPlan && selectedPlanId !== requestedPlan.id) {
                onSelectRequestedPlan(requestedPlan);
                return;
            }
        }

        if (requestedPlanMissing) return;

        if (requestedPlanId === selectedPlanId && requestedStep === selectedStep) {
            lastRouteReplacementKeyRef.current = undefined;
            return;
        }

        const replacementKey = `${guildId}\0${selectedPlanId ?? ''}\0${selectedStep}`;
        if (lastRouteReplacementKeyRef.current === replacementKey) return;

        lastRouteReplacementKeyRef.current = replacementKey;
        onReplaceRoute(selectedPlanId, selectedStep);
    }, [
        guildId,
        onReplaceRoute,
        ready,
        requestedPlanId,
        requestedPlanMissing,
        requestedPlan,
        requestedStep,
        routeSelectionKey,
        selectedPlanId,
        selectedStep,
        onSelectRequestedPlan,
    ]);
}
