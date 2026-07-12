import type { ReactNode } from 'react';

import { DashboardStructureErrorState } from './dashboard-structure-error-boundary.js';
import { DashboardStructureLoading } from './dashboard-structure-panel-shared.js';
import type { DashboardStructurePanelViewProps } from './dashboard-structure-panel-view.js';

export type DashboardStructureControllerState =
    | { type: 'loading' }
    | { type: 'error'; diagnosticCode: string; retry: () => void }
    | { type: 'ready'; workspace: DashboardStructurePanelViewProps };

export function renderDashboardStructureControllerState(
    state: DashboardStructureControllerState,
    renderReady: (workspace: DashboardStructurePanelViewProps) => ReactNode
): ReactNode {
    switch (state.type) {
        case 'loading':
            return <DashboardStructureLoading />;

        case 'error':
            return (
                <DashboardStructureErrorState
                    title='Server Blueprint could not load'
                    message={
                        state.diagnosticCode === 'BLUEPRINT_LOAD_BACKEND_INCOMPATIBLE'
                            ? 'The Convex backend does not match this NeonFlux build. Deploy the matching backend before using Server Blueprint.'
                            : 'The dashboard did not receive Blueprint data. Retry the read; this does not queue or apply a deployment.'
                    }
                    diagnosticCode={state.diagnosticCode}
                    onRetry={state.retry}
                />
            );

        case 'ready':
            return renderReady(state.workspace);
    }
}
