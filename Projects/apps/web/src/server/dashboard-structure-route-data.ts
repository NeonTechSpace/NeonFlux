import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardStructureConfirmInput,
    DashboardStructureConfirmResult,
    DashboardStructureDryRunInput,
    DashboardStructureDryRunResult,
    DashboardStructureExportResult,
    DashboardStructureSettingsResult,
} from './dashboard-structure.server.js';
import type {
    DashboardStructurePreflightInput,
    DashboardStructurePreflightResult,
} from './dashboard-structure-preflight.server.js';
import type {
    DashboardStructureApplyInput,
    DashboardStructureApplyResult,
} from './dashboard-structure-apply.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

export const readDashboardStructureSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardStructureSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardStructureSettings } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardStructureSettings(getRequest(), data.guildId);
    });

export const exportDashboardStructureRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardStructureExportResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { exportDashboardStructure } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return exportDashboardStructure(getRequest(), data.guildId);
    });

export const createDashboardStructureDryRunRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureDryRunInput)
    .handler(async ({ data }): Promise<DashboardStructureDryRunResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { createDashboardStructureImportDryRun } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return createDashboardStructureImportDryRun(getRequest(), data);
    });

export const confirmDashboardStructureImportRunRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureConfirmInput)
    .handler(async ({ data }): Promise<DashboardStructureConfirmResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { confirmDashboardStructureImportRun } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return confirmDashboardStructureImportRun(getRequest(), data);
    });

export const preflightDashboardStructureImportRunRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructurePreflightInput)
    .handler(async ({ data }): Promise<DashboardStructurePreflightResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { preflightDashboardStructureImportRun } = await import('./dashboard-structure-preflight.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return preflightDashboardStructureImportRun(getRequest(), data);
    });

export const applyDashboardStructureImportRunRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureApplyInput)
    .handler(async ({ data }): Promise<DashboardStructureApplyResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { applyDashboardStructureImportRun } = await import('./dashboard-structure-apply.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return applyDashboardStructureImportRun(getRequest(), data);
    });

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') return { guildId: '' };

    return {
        guildId: readString((input as Record<string, unknown>).guildId),
    };
}

function validateDashboardStructureDryRunInput(input: unknown): DashboardStructureDryRunInput {
    if (!input || typeof input !== 'object') return { guildId: '', snapshotJson: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        snapshotJson: readString(payload.snapshotJson),
    };
}

function validateDashboardStructureConfirmInput(input: unknown): DashboardStructureConfirmInput {
    if (!input || typeof input !== 'object') return { guildId: '', importRunId: '', confirmationText: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        importRunId: readString(payload.importRunId),
        confirmationText: readString(payload.confirmationText),
    };
}

function validateDashboardStructurePreflightInput(input: unknown): DashboardStructurePreflightInput {
    if (!input || typeof input !== 'object') return { guildId: '', importRunId: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        importRunId: readString(payload.importRunId),
    };
}

function validateDashboardStructureApplyInput(input: unknown): DashboardStructureApplyInput {
    if (!input || typeof input !== 'object') return { guildId: '', importRunId: '', confirmationText: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        importRunId: readString(payload.importRunId),
        confirmationText: readString(payload.confirmationText),
        destructiveConfirmationText: readString(payload.destructiveConfirmationText),
    };
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
