import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardStructureActionPageInput,
    DashboardStructureActionPageResult,
    DashboardStructureBackupDeleteInput,
    DashboardStructureBackupDeleteResult,
    DashboardStructureBackupImportInput,
    DashboardStructureBackupImportResult,
    DashboardStructureBackupPageInput,
    DashboardStructureBackupPageResult,
    DashboardStructureBackupRenameInput,
    DashboardStructureBackupRenameResult,
    DashboardStructureBackupResult,
    DashboardStructureBackupJsonResult,
    DashboardStructureBackupSettingsInput,
    DashboardStructureBackupSettingsResult,
    DashboardStructureConfirmInput,
    DashboardStructureConfirmResult,
    DashboardStructureCurrentExportResult,
    DashboardStructureDriftInput,
    DashboardStructureDriftResult,
    DashboardStructureDryRunInput,
    DashboardStructureDryRunResult,
    DashboardStructureRetryInput,
    DashboardStructureRetryResult,
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
    .handler(async ({ data }): Promise<DashboardStructureBackupResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { exportDashboardStructure } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return exportDashboardStructure(getRequest(), data.guildId);
    });

export const downloadDashboardStructureExportRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardStructureCurrentExportResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { downloadDashboardStructureExport } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return downloadDashboardStructureExport(getRequest(), data.guildId);
    });

export const readDashboardStructureBackupJsonRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardStructureBackupJsonInput)
    .handler(async ({ data }): Promise<DashboardStructureBackupJsonResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardStructureBackupJson } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardStructureBackupJson(getRequest(), data);
    });

export const readDashboardStructureBackupPageRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardStructureBackupPageInput)
    .handler(async ({ data }): Promise<DashboardStructureBackupPageResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardStructureBackupPage } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardStructureBackupPage(getRequest(), data);
    });

export const readDashboardStructureDriftRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureDriftInput)
    .handler(async ({ data }): Promise<DashboardStructureDriftResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardStructureDrift } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardStructureDrift(getRequest(), data);
    });

export const renameDashboardStructureBackupRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureBackupRenameInput)
    .handler(async ({ data }): Promise<DashboardStructureBackupRenameResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { renameDashboardStructureBackup } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return renameDashboardStructureBackup(getRequest(), data);
    });

export const importDashboardStructureBackupRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureBackupImportInput)
    .handler(async ({ data }): Promise<DashboardStructureBackupImportResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { importDashboardStructureBackup } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return importDashboardStructureBackup(getRequest(), data);
    });

export const deleteDashboardStructureBackupRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureBackupDeleteInput)
    .handler(async ({ data }): Promise<DashboardStructureBackupDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardStructureBackup } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardStructureBackup(getRequest(), data);
    });

export const saveDashboardStructureBackupSettingsRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureBackupSettingsInput)
    .handler(async ({ data }): Promise<DashboardStructureBackupSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { saveDashboardStructureBackupSettings } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return saveDashboardStructureBackupSettings(getRequest(), data);
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

export const retryDashboardStructureImportRunRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureRetryInput)
    .handler(async ({ data }): Promise<DashboardStructureRetryResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { retryDashboardStructureImportRun } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return retryDashboardStructureImportRun(getRequest(), data);
    });

export const readDashboardStructureImportActionPageRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardStructureActionPageInput)
    .handler(async ({ data }): Promise<DashboardStructureActionPageResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardStructureImportActionPage } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardStructureImportActionPage(getRequest(), data);
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
    if (!input || typeof input !== 'object') return { guildId: '', backupJson: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        backupJson: readString(payload.backupJson),
    };
}

function validateDashboardStructureBackupJsonInput(input: unknown): { backupId: string; guildId: string } {
    if (!input || typeof input !== 'object') return { backupId: '', guildId: '' };

    const payload = input as Record<string, unknown>;

    return {
        backupId: readString(payload.backupId),
        guildId: readString(payload.guildId),
    };
}

function validateDashboardStructureBackupPageInput(input: unknown): DashboardStructureBackupPageInput {
    if (!input || typeof input !== 'object') return { guildId: '' };

    const payload = input as Record<string, unknown>;
    const limit = payload.limit;

    return {
        cursor: readString(payload.cursor) || undefined,
        guildId: readString(payload.guildId),
        limit: typeof limit === 'number' ? limit : undefined,
    };
}

function validateDashboardStructureDriftInput(input: unknown): DashboardStructureDriftInput {
    if (!input || typeof input !== 'object') return { guildId: '' };

    const payload = input as Record<string, unknown>;

    return {
        baselineBackupId: readString(payload.baselineBackupId) || undefined,
        guildId: readString(payload.guildId),
    };
}

function validateDashboardStructureBackupRenameInput(input: unknown): DashboardStructureBackupRenameInput {
    if (!input || typeof input !== 'object') return { backupId: '', guildId: '', name: '' };

    const payload = input as Record<string, unknown>;

    return {
        backupId: readString(payload.backupId),
        guildId: readString(payload.guildId),
        name: readString(payload.name),
    };
}

function validateDashboardStructureBackupDeleteInput(input: unknown): DashboardStructureBackupDeleteInput {
    if (!input || typeof input !== 'object') return { backupId: '', guildId: '' };

    const payload = input as Record<string, unknown>;

    return {
        backupId: readString(payload.backupId),
        guildId: readString(payload.guildId),
    };
}

function validateDashboardStructureBackupImportInput(input: unknown): DashboardStructureBackupImportInput {
    return validateDashboardStructureBackupDeleteInput(input);
}

function validateDashboardStructureBackupSettingsInput(input: unknown): DashboardStructureBackupSettingsInput {
    if (!input || typeof input !== 'object')
        return { cadenceWeeks: 1, enabled: false, guildId: '', retentionDays: 180 };

    const payload = input as Record<string, unknown>;
    const cadenceWeeks = payload.cadenceWeeks;
    const retentionDays = payload.retentionDays;

    return {
        cadenceWeeks: typeof cadenceWeeks === 'number' ? cadenceWeeks : 1,
        enabled: payload.enabled === true,
        guildId: readString(payload.guildId),
        retentionDays: typeof retentionDays === 'number' ? retentionDays : 180,
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

function validateDashboardStructureRetryInput(input: unknown): DashboardStructureRetryInput {
    if (!input || typeof input !== 'object') return { guildId: '', importRunId: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        importRunId: readString(payload.importRunId),
    };
}

function validateDashboardStructureActionPageInput(input: unknown): DashboardStructureActionPageInput {
    if (!input || typeof input !== 'object') return { guildId: '', importRunId: '' };

    const payload = input as Record<string, unknown>;
    const limit = payload.limit;

    return {
        cursor: readString(payload.cursor) || undefined,
        guildId: readString(payload.guildId),
        importRunId: readString(payload.importRunId),
        limit: typeof limit === 'number' ? limit : undefined,
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
