import { createServerFn } from '@tanstack/react-start';
import {
    FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS,
    isFluxerGuildStructureSnapshotJsonWithinByteLimit,
} from '@neonflux/fluxer/guild-structure-snapshot';

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
    DashboardStructureBackupsResult,
    DashboardStructureApprovalInput,
    DashboardStructureApprovalResult,
    DashboardStructureCurrentExportResult,
    DashboardStructureDriftInput,
    DashboardStructureDriftResult,
    DashboardStructurePlanInput,
    DashboardStructurePlanResult,
    DashboardStructureRecoveryInput,
    DashboardStructureRecoveryResult,
    DashboardStructureRunsResult,
    DashboardStructureStatusResult,
} from './dashboard-structure.server.js';
import type {
    DashboardStructureDecisionPageInput,
    DashboardStructureDecisionPageResult,
} from './dashboard-structure-plan-persistence.server.js';
import type {
    DashboardStructurePreflightInput,
    DashboardStructurePreflightResult,
} from './dashboard-structure-preflight.server.js';
import type {
    DashboardStructureApplyInput,
    DashboardStructureApplyResult,
    DashboardStructureExecutionControlInput,
    DashboardStructureExecutionControlResult,
} from './dashboard-structure-apply.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

export const readDashboardStructureStatusRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardStructureStatusResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardStructureStatus } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        try {
            return await loadDashboardStructureStatus(getRequest(), data.guildId);
        } catch (error) {
            const { ConvexRuntimeContractError } = await import('@neonflux/db');
            if (error instanceof ConvexRuntimeContractError) return { type: 'backend-incompatible' };
            throw error;
        }
    });

export const readDashboardStructureBackupsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardStructureBackupsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardStructureBackups } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        try {
            return await loadDashboardStructureBackups(getRequest(), data.guildId);
        } catch (error) {
            const { ConvexRuntimeContractError } = await import('@neonflux/db');
            if (error instanceof ConvexRuntimeContractError) return { type: 'backend-incompatible' };
            throw error;
        }
    });

export const readDashboardStructureRunsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardStructureRunsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardStructureRuns } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        try {
            return await loadDashboardStructureRuns(getRequest(), data.guildId);
        } catch (error) {
            const { ConvexRuntimeContractError } = await import('@neonflux/db');
            if (error instanceof ConvexRuntimeContractError) return { type: 'backend-incompatible' };
            throw error;
        }
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

export const createDashboardStructurePlanRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructurePlanInput)
    .handler(async ({ data }): Promise<DashboardStructurePlanResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { createDashboardStructureImportPlan } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return createDashboardStructureImportPlan(getRequest(), data);
    });

export const approveDashboardStructurePlanRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureApprovalInput)
    .handler(async ({ data }): Promise<DashboardStructureApprovalResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { approveDashboardStructurePlan } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return approveDashboardStructurePlan(getRequest(), data);
    });

export const createDashboardStructureRecoveryPlanRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureRecoveryInput)
    .handler(async ({ data }): Promise<DashboardStructureRecoveryResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { createDashboardStructureRecoveryPlan } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return createDashboardStructureRecoveryPlan(getRequest(), data);
    });

export const readDashboardStructureImportActionPageRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardStructureActionPageInput)
    .handler(async ({ data }): Promise<DashboardStructureActionPageResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardStructureImportActionPage } = await import('./dashboard-structure.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardStructureImportActionPage(getRequest(), data);
    });

export const readDashboardStructureImportDecisionPageRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardStructureDecisionPageInput)
    .handler(async ({ data }): Promise<DashboardStructureDecisionPageResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardStructureImportDecisionPage } =
            await import('./dashboard-structure-plan-persistence.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return readDashboardStructureImportDecisionPage(getRequest(), data);
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

export const controlDashboardStructureImportExecutionRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardStructureExecutionControlInput)
    .handler(async ({ data }): Promise<DashboardStructureExecutionControlResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { controlDashboardStructureImportExecution } = await import('./dashboard-structure-apply.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return controlDashboardStructureImportExecution(getRequest(), data);
    });

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') return { guildId: '' };

    return {
        guildId: readString((input as Record<string, unknown>).guildId),
    };
}

export function validateDashboardStructurePlanInput(input: unknown): DashboardStructurePlanInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', backupJson: '', policy: '' as DashboardStructurePlanInput['policy'] };
    }

    const payload = input as Record<string, unknown>;

    const backupJson = readString(payload.backupJson);
    if (!isFluxerGuildStructureSnapshotJsonWithinByteLimit(backupJson)) {
        throw new Error(
            `Server blueprint JSON cannot exceed ${String(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes / 1024 / 1024)} MiB.`
        );
    }

    return {
        guildId: readString(payload.guildId),
        backupJson,
        policy: readString(payload.policy) as DashboardStructurePlanInput['policy'],
        roleMappings: readStringMap(payload.roleMappings),
        categoryMappings: readStringMap(payload.categoryMappings),
        channelMappings: readStringMap(payload.channelMappings),
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

function validateDashboardStructureApprovalInput(input: unknown): DashboardStructureApprovalInput {
    if (!input || typeof input !== 'object') return { guildId: '', importRunId: '', planDigest: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        importRunId: readString(payload.importRunId),
        planDigest: readString(payload.planDigest),
    };
}

function validateDashboardStructureRecoveryInput(input: unknown): DashboardStructureRecoveryInput {
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

function validateDashboardStructureDecisionPageInput(input: unknown): DashboardStructureDecisionPageInput {
    const payload = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    return {
        guildId: readString(payload.guildId),
        importRunId: readString(payload.importRunId),
        cursor: typeof payload.cursor === 'number' ? payload.cursor : undefined,
        limit: typeof payload.limit === 'number' ? payload.limit : undefined,
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
    if (!input || typeof input !== 'object') {
        return { guildId: '', importRunId: '', planDigest: '', preflightDigest: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        importRunId: readString(payload.importRunId),
        planDigest: readString(payload.planDigest),
        preflightDigest: readString(payload.preflightDigest),
        destructiveConfirmationText: readString(payload.destructiveConfirmationText) || undefined,
    };
}

export function validateDashboardStructureExecutionControlInput(
    input: unknown
): DashboardStructureExecutionControlInput {
    const payload = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const request = payload.request;
    if (request !== 'pause' && request !== 'resume' && request !== 'cancel') {
        throw new Error('Execution control request must be pause, resume, or cancel.');
    }

    return {
        guildId: readString(payload.guildId),
        runId: readString(payload.runId),
        executionId: readString(payload.executionId),
        request,
    };
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function readStringMap(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const entries = Object.entries(value).filter(
        (entry): entry is [string, string] =>
            Boolean(entry[0].trim()) && typeof entry[1] === 'string' && Boolean(entry[1].trim())
    );

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
