import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
    readDashboardBlueprintPlanStepPageRouteData,
    readDashboardBlueprintPlanDecisionPageRouteData,
} from '../server/dashboard-blueprint-route-data.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';
import type { PlanStepPageState, PanelStatus } from './dashboard-blueprint-panel-types.js';

export function useDashboardBlueprintPlanInspectionState({
    guildId,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    setBusyAction: Dispatch<SetStateAction<BlueprintBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    const [stepPagesByPlanId, setStepPagesByPlanId] = useState<Partial<Record<string, PlanStepPageState>>>({});
    const [decisionPagesByPlanId, setDecisionPagesByPlanId] = useState<
        Partial<Record<string, { decisions: DashboardBlueprintPlan['decisions']; nextCursor?: number }>>
    >({});

    function seedPlanSteps(plan: DashboardBlueprintPlan): void {
        setStepPagesByPlanId((current) => ({ ...current, [plan.id]: { steps: plan.steps } }));
    }

    async function loadPlanSteps(plan: DashboardBlueprintPlan): Promise<void> {
        setBusyAction(`plan-steps:${plan.id}`);

        try {
            const currentPage = stepPagesByPlanId[plan.id];
            const result = await readDashboardBlueprintPlanStepPageRouteData({
                data: {
                    guildId,
                    planId: plan.id,
                    ...(currentPage?.nextCursor ? { cursor: currentPage.nextCursor } : {}),
                    limit: 100,
                },
            });

            if (result.type !== 'plan-step-page') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setStepPagesByPlanId((current) => {
                const existingPage = current[plan.id];
                return {
                    ...current,
                    [plan.id]: {
                        steps: [...(existingPage?.steps ?? []), ...result.page.steps],
                        ...(result.page.nextCursor ? { nextCursor: result.page.nextCursor } : {}),
                    },
                };
            });
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function loadPlanDecisions(plan: DashboardBlueprintPlan): Promise<void> {
        setBusyAction(`decisions:${plan.id}`);

        try {
            const currentPage = decisionPagesByPlanId[plan.id];
            const result = await readDashboardBlueprintPlanDecisionPageRouteData({
                data: {
                    guildId,
                    planId: plan.id,
                    ...(currentPage?.nextCursor !== undefined ? { cursor: currentPage.nextCursor } : {}),
                    limit: 50,
                },
            });
            if (result.type !== 'decision-page') {
                setStatus(toErrorStatus(result.type));
                return;
            }
            setDecisionPagesByPlanId((pages) => ({
                ...pages,
                [plan.id]: {
                    decisions: [...(pages[plan.id]?.decisions ?? []), ...result.decisions],
                    ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
                },
            }));
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    return {
        stepPagesByPlanId,
        decisionPagesByPlanId,
        loadPlanSteps,
        loadPlanDecisions,
        seedPlanSteps,
    };
}
