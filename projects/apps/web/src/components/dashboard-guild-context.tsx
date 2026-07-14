import { createContext, use } from 'react';
import type { ReactNode } from 'react';

import type { DashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';

export type AuthorizedDashboardGuildRouteData = Extract<DashboardGuildRouteData, { type: 'guild' }>;

const DashboardGuildDataContext = createContext<AuthorizedDashboardGuildRouteData | undefined>(undefined);

export function DashboardGuildDataProvider({
    data,
    children,
}: {
    data: AuthorizedDashboardGuildRouteData;
    children: ReactNode;
}) {
    return (
        <DashboardGuildDataContext key={data.guild.id} value={data}>
            {children}
        </DashboardGuildDataContext>
    );
}

export function useDashboardGuildData(): AuthorizedDashboardGuildRouteData {
    const data = use(DashboardGuildDataContext);

    if (!data) {
        throw new Error('Dashboard guild category rendered outside the guild dashboard context.');
    }

    return data;
}
