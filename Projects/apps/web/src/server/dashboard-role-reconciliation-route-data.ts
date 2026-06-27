import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardRoleReconciliationSettingsResult,
    DashboardRoleReconciliationSettingsUpdateResult,
} from './dashboard-role-reconciliation.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardRoleReconciliationSettingsUpdateRouteInput = {
    guildId: string;
    enabled?: boolean;
    restoreAutoroleRoles?: boolean;
    restoreVerificationRoles?: boolean;
    restoreReactionRoles?: boolean;
    cleanupDeletedRoleReferences?: boolean;
};

export const readDashboardRoleReconciliationSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardRoleReconciliationSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardRoleReconciliationSettings } = await import('./dashboard-role-reconciliation.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardRoleReconciliationSettings(getRequest(), data.guildId);
    });

export const updateDashboardRoleReconciliationSettingsRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardRoleReconciliationSettingsUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardRoleReconciliationSettingsUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardRoleReconciliationSettings } = await import('./dashboard-role-reconciliation.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardRoleReconciliationSettings(getRequest(), data);
    });

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const guildId = (input as Record<string, unknown>).guildId;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
    };
}

function validateDashboardRoleReconciliationSettingsUpdateRouteInput(
    input: unknown
): DashboardRoleReconciliationSettingsUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        ...booleanField(payload, 'enabled'),
        ...booleanField(payload, 'restoreAutoroleRoles'),
        ...booleanField(payload, 'restoreVerificationRoles'),
        ...booleanField(payload, 'restoreReactionRoles'),
        ...booleanField(payload, 'cleanupDeletedRoleReferences'),
    };
}

function booleanField(
    payload: Record<string, unknown>,
    field:
        | 'enabled'
        | 'restoreAutoroleRoles'
        | 'restoreVerificationRoles'
        | 'restoreReactionRoles'
        | 'cleanupDeletedRoleReferences'
): Partial<DashboardRoleReconciliationSettingsUpdateRouteInput> {
    const value = payload[field];

    return typeof value === 'boolean' ? { [field]: value } : {};
}
