export type DashboardGuildReadFailureType =
    | 'auth-required'
    | 'bot-token-missing'
    | 'database-error'
    | 'deployment-config-not-found'
    | 'guild-lookup-failed'
    | 'not-found';

export class DashboardGuildReadError extends Error {
    constructor(readonly type: DashboardGuildReadFailureType) {
        super(`Dashboard guild read failed: ${type}`);
        this.name = 'DashboardGuildReadError';
    }
}

export function readDashboardGuildReadFailureType(error: unknown): DashboardGuildReadFailureType {
    return error instanceof DashboardGuildReadError ? error.type : 'database-error';
}

export function canRetryDashboardGuildRead(type: DashboardGuildReadFailureType): boolean {
    return type === 'database-error' || type === 'guild-lookup-failed';
}
