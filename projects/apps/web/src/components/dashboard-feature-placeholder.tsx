import type { ReactNode } from 'react';

import { DashboardEmptyState, DashboardSurface } from './dashboard-ui.js';

export function DashboardFeaturePlaceholder({ action }: { action: ReactNode }) {
    return (
        <DashboardSurface tone='glass'>
            <DashboardEmptyState
                title='Not available yet'
                description='This planned destination does not have usable controls yet.'
                action={action}
            />
        </DashboardSurface>
    );
}
