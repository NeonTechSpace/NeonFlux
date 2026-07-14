import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
    readDashboardStructureImportActionPageRouteData,
    readDashboardStructureImportDecisionPageRouteData,
} from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-structure-panel-status.js';
import type { ActionPageState, PanelStatus } from './dashboard-structure-panel-types.js';

export function useDashboardStructureRunInspectionState({
    guildId,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    setBusyAction: Dispatch<SetStateAction<StructureBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    const [actionPagesByRunId, setActionPagesByRunId] = useState<Partial<Record<string, ActionPageState>>>({});
    const [decisionPagesByRunId, setDecisionPagesByRunId] = useState<
        Partial<Record<string, { decisions: DashboardStructureImportRun['decisions']; nextCursor?: number }>>
    >({});

    function seedRunActions(run: DashboardStructureImportRun): void {
        setActionPagesByRunId((current) => ({ ...current, [run.id]: { actions: run.actions } }));
    }

    async function loadRunActions(run: DashboardStructureImportRun): Promise<void> {
        setBusyAction(`actions:${run.id}`);

        try {
            const currentPage = actionPagesByRunId[run.id];
            const result = await readDashboardStructureImportActionPageRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    ...(currentPage?.nextCursor ? { cursor: currentPage.nextCursor } : {}),
                    limit: 100,
                },
            });

            if (result.type !== 'action-page') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setActionPagesByRunId((current) => {
                const existingPage = current[run.id];
                return {
                    ...current,
                    [run.id]: {
                        actions: [...(existingPage?.actions ?? []), ...result.page.actions],
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

    async function loadRunDecisions(run: DashboardStructureImportRun): Promise<void> {
        setBusyAction(`decisions:${run.id}`);

        try {
            const currentPage = decisionPagesByRunId[run.id];
            const result = await readDashboardStructureImportDecisionPageRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    ...(currentPage?.nextCursor !== undefined ? { cursor: currentPage.nextCursor } : {}),
                    limit: 50,
                },
            });
            if (result.type !== 'decision-page') {
                setStatus(toErrorStatus(result.type));
                return;
            }
            setDecisionPagesByRunId((pages) => ({
                ...pages,
                [run.id]: {
                    decisions: [...(pages[run.id]?.decisions ?? []), ...result.decisions],
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
        actionPagesByRunId,
        decisionPagesByRunId,
        loadRunActions,
        loadRunDecisions,
        seedRunActions,
    };
}
