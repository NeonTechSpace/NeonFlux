export const dashboardPostingOperationResolutions = [
    'reported_seen',
    'reported_not_seen',
    'duplicate_risk_accepted',
] as const;

export type DashboardPostingOperationResolution = (typeof dashboardPostingOperationResolutions)[number];

export function isDashboardPostingOperationResolution(value: unknown): value is DashboardPostingOperationResolution {
    return value === 'reported_seen' || value === 'reported_not_seen' || value === 'duplicate_risk_accepted';
}
