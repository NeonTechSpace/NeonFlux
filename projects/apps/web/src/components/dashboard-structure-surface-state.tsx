import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { dashboardContentVariants, dashboardRouteTransition } from './dashboard-motion.js';
import { DashboardStructureErrorState } from './dashboard-structure-error-boundary.js';
import { DashboardStructureLoading, StatusMessage } from './dashboard-structure-panel-shared.js';
import type { PanelStatus } from './dashboard-structure-panel-types.js';
import { dashboardStructureSurfaceIdentity } from './dashboard-structure-surface.js';
import type { DashboardStructureSurface } from './dashboard-structure-surface.js';
import { dashboardSecondaryActionClassName, DashboardStatus } from './dashboard-ui.js';

export function DashboardStructurePendingSurface({
    surface,
    error,
}: {
    surface: DashboardStructureSurface;
    error?: { diagnosticCode: string; retry: () => void; retrying?: boolean };
}) {
    const identity = dashboardStructureSurfaceIdentity[surface];

    return (
        <section aria-labelledby={`blueprint-${surface}-heading`}>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h2 id={`blueprint-${surface}-heading`} className='text-lg font-semibold text-[var(--dash-text)]'>
                    {identity.heading}
                </h2>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{identity.description}</p>
            </div>
            {error ? (
                <DashboardStructureErrorState
                    title={`${identity.heading} could not load`}
                    message='The dashboard did not receive this Blueprint data slice. Other Blueprint tools remain available.'
                    diagnosticCode={error.diagnosticCode}
                    onRetry={error.retry}
                    retrying={error.retrying}
                />
            ) : (
                <DashboardStructureLoading />
            )}
        </section>
    );
}

export function DashboardStructureSurfaceContent({
    children,
    refreshIssue,
    refreshRetrying,
    onRetryRefresh,
    status,
}: {
    children: ReactNode;
    refreshIssue?: { code: string };
    refreshRetrying?: boolean;
    onRetryRefresh: () => void;
    status?: PanelStatus;
}) {
    return (
        <motion.div
            data-dashboard-motion='route-arrival'
            variants={dashboardContentVariants}
            initial='initial'
            animate='enter'
            transition={dashboardRouteTransition}>
            {refreshIssue ? (
                <DashboardStatus
                    tone='danger'
                    actions={
                        <button
                            type='button'
                            onClick={onRetryRefresh}
                            disabled={refreshRetrying}
                            aria-busy={refreshRetrying || undefined}
                            className={dashboardSecondaryActionClassName}>
                            {refreshRetrying ? 'Retrying…' : 'Retry Blueprint refresh'}
                        </button>
                    }>
                    Blueprint data could not refresh. The last confirmed workspace remains visible.
                </DashboardStatus>
            ) : null}
            {status ? (
                <div className='mb-5'>
                    <StatusMessage status={status} />
                </div>
            ) : null}
            {children}
        </motion.div>
    );
}
