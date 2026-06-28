import '@tanstack/react-start/server-only';

import type { DashboardReactionRoleMutationErrorResult } from './dashboard-reaction-roles-types.js';

export function mapReactionRoleRepositoryError(error: {
    type: string;
    field?: string;
}): DashboardReactionRoleMutationErrorResult {
    switch (error.type) {
        case 'missing-input':
        case 'invalid-value':
            return { type: 'invalid-input', field: error.field ?? 'unknown' };
        case 'not-found':
            return { type: 'not-found' };
        case 'database-error':
        default:
            return { type: 'database-error' };
    }
}
