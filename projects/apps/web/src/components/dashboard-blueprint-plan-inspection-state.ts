import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
    readDashboardBlueprintPlanStepPageRouteData,
    readDashboardBlueprintPlanDecisionPageRouteData,
} from '../server/dashboard-blueprint-route-data.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import type { BlueprintBusyAction, PlanStepPageState, PanelStatus } from './dashboard-blueprint-panel-types.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';

export function useDashboardBlueprintPlanInspectionState({
    guildId,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    setBusyAction: Dispatch<SetStateAction<BlueprintBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    const [stepPageState, setStepPageState] = useState<{
        guildId: string;
        pages: Partial<Record<string, PlanStepPageState>>;
    }>({ guildId, pages: {} });
    const [decisionPageState, setDecisionPageState] = useState<{
        guildId: string;
        pages: Partial<Record<string, { decisions: DashboardBlueprintPlan['decisions']; nextCursor?: number }>>;
    }>({ guildId, pages: {} });
    const stepPagesByPlanId = stepPageState.guildId === guildId ? stepPageState.pages : {};
    const decisionPagesByPlanId = decisionPageState.guildId === guildId ? decisionPageState.pages : {};
    const requestSequencesRef = useRef(new Map<string, number>());
    const guildIdRef = useRef(guildId);
    useEffect(() => {
        guildIdRef.current = guildId;
        requestSequencesRef.current.clear();
    }, [guildId]);

    function seedPlanSteps(plan: DashboardBlueprintPlan): void {
        setStepPageState((current) => ({
            guildId,
            pages: { ...(current.guildId === guildId ? current.pages : {}), [plan.id]: { steps: plan.steps } },
        }));
    }

    async function loadPlanSteps(plan: DashboardBlueprintPlan): Promise<void> {
        const requestKey = `steps:${guildId}:${plan.id}`;
        const requestSequence = beginDetailRequest(requestKey);
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

            if (!isCurrentDetailRequest(requestKey, requestSequence)) return;

            if (result.type !== 'plan-step-page') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setStepPageState((current) => {
                const pages = current.guildId === guildId ? current.pages : {};
                const existingPage = pages[plan.id];
                return {
                    guildId,
                    pages: {
                        ...pages,
                        [plan.id]: {
                            steps: [...(existingPage?.steps ?? []), ...result.page.steps],
                            ...(result.page.nextCursor ? { nextCursor: result.page.nextCursor } : {}),
                        },
                    },
                };
            });
        } catch {
            if (isCurrentDetailRequest(requestKey, requestSequence)) setStatus(toUnexpectedErrorStatus());
        } finally {
            if (isCurrentDetailRequest(requestKey, requestSequence)) setBusyAction(undefined);
        }
    }

    async function loadPlanDecisions(plan: DashboardBlueprintPlan): Promise<void> {
        const requestKey = `decisions:${guildId}:${plan.id}`;
        const requestSequence = beginDetailRequest(requestKey);
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
            if (!isCurrentDetailRequest(requestKey, requestSequence)) return;
            if (result.type !== 'decision-page') {
                setStatus(toErrorStatus(result.type));
                return;
            }
            setDecisionPageState((current) => {
                const pages = current.guildId === guildId ? current.pages : {};
                return {
                    guildId,
                    pages: {
                        ...pages,
                        [plan.id]: {
                            decisions: [...(pages[plan.id]?.decisions ?? []), ...result.decisions],
                            ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
                        },
                    },
                };
            });
        } catch {
            if (isCurrentDetailRequest(requestKey, requestSequence)) setStatus(toUnexpectedErrorStatus());
        } finally {
            if (isCurrentDetailRequest(requestKey, requestSequence)) setBusyAction(undefined);
        }
    }

    function beginDetailRequest(requestKey: string): number {
        const next = (requestSequencesRef.current.get(requestKey) ?? 0) + 1;
        requestSequencesRef.current.set(requestKey, next);
        return next;
    }

    function isCurrentDetailRequest(requestKey: string, requestSequence: number): boolean {
        return (
            requestSequencesRef.current.get(requestKey) === requestSequence &&
            requestKey.includes(`:${guildIdRef.current}:`)
        );
    }

    return {
        stepPagesByPlanId,
        decisionPagesByPlanId,
        loadPlanSteps,
        loadPlanDecisions,
        seedPlanSteps,
    };
}
