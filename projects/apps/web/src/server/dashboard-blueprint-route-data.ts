import { createServerFn } from '@tanstack/react-start';
import { BLUEPRINT_SNAPSHOT_LIMITS, isBlueprintSnapshotJsonWithinByteLimit } from '@neonflux/blueprint/snapshot';

import type {
    DashboardBlueprintPlanStepPageInput,
    DashboardBlueprintPlanStepPageResult,
    DashboardBlueprintBackupDeleteInput,
    DashboardBlueprintBackupDeleteResult,
    DashboardBlueprintBackupImportInput,
    DashboardBlueprintBackupImportResult,
    DashboardBlueprintBackupPageInput,
    DashboardBlueprintBackupPageResult,
    DashboardBlueprintBackupRenameInput,
    DashboardBlueprintBackupRenameResult,
    DashboardBlueprintBackupResult,
    DashboardBlueprintBackupJsonResult,
    DashboardBlueprintBackupSettingsInput,
    DashboardBlueprintBackupSettingsResult,
    DashboardBlueprintBackupsResult,
    DashboardBlueprintApprovalInput,
    DashboardBlueprintApprovalResult,
    DashboardBlueprintCurrentExportResult,
    DashboardBlueprintDriftInput,
    DashboardBlueprintDriftResult,
    DashboardBlueprintPlanInput,
    DashboardBlueprintPlanResult,
    DashboardBlueprintRecoveryInput,
    DashboardBlueprintRecoveryResult,
    DashboardBlueprintRunsResult,
    DashboardBlueprintStatusResult,
} from './dashboard-blueprint-model.js';
import type {
    DashboardBlueprintDecisionPageInput,
    DashboardBlueprintDecisionPageResult,
} from './dashboard-blueprint-plan-persistence.server.js';
import type {
    DashboardBlueprintPreflightInput,
    DashboardBlueprintPreflightResult,
} from './dashboard-blueprint-preflight.server.js';
import type {
    DashboardBlueprintApplyInput,
    DashboardBlueprintApplyResult,
    DashboardBlueprintRunControlInput,
    DashboardBlueprintRunControlResult,
} from './dashboard-blueprint-apply.server.js';
import type {
    DashboardBlueprintPlanAuthorityInput,
    DashboardBlueprintPlanAuthorityResult,
    DashboardBlueprintPreflightEvidenceInput,
    DashboardBlueprintPreflightEvidenceResult,
    DashboardBlueprintVerificationEvidenceInput,
    DashboardBlueprintVerificationEvidenceResult,
} from './dashboard-blueprint-plan-detail.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

export const readDashboardBlueprintStatusRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardBlueprintStatusResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardBlueprintStatus } = await import('./dashboard-blueprint-runs.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        try {
            return await loadDashboardBlueprintStatus(getRequest(), data.guildId);
        } catch (error) {
            const { ConvexRuntimeContractError } = await import('@neonflux/db');
            if (error instanceof ConvexRuntimeContractError) return { type: 'backend-incompatible' };
            throw error;
        }
    });

export const readDashboardBlueprintBackupsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardBlueprintBackupsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardBlueprintBackups } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        try {
            return await loadDashboardBlueprintBackups(getRequest(), data.guildId);
        } catch (error) {
            const { ConvexRuntimeContractError } = await import('@neonflux/db');
            if (error instanceof ConvexRuntimeContractError) return { type: 'backend-incompatible' };
            throw error;
        }
    });

export const readDashboardBlueprintRunsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardBlueprintRunsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardBlueprintRuns } = await import('./dashboard-blueprint-runs.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        try {
            return await loadDashboardBlueprintRuns(getRequest(), data.guildId);
        } catch (error) {
            const { ConvexRuntimeContractError } = await import('@neonflux/db');
            if (error instanceof ConvexRuntimeContractError) return { type: 'backend-incompatible' };
            throw error;
        }
    });

export const exportDashboardBlueprintRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardBlueprintBackupResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { exportDashboardBlueprint } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return exportDashboardBlueprint(getRequest(), data.guildId);
    });

export const downloadDashboardBlueprintExportRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardBlueprintCurrentExportResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { downloadDashboardBlueprintExport } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return downloadDashboardBlueprintExport(getRequest(), data.guildId);
    });

export const readDashboardBlueprintBackupJsonRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardBlueprintBackupJsonInput)
    .handler(async ({ data }): Promise<DashboardBlueprintBackupJsonResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardBlueprintBackupJson } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardBlueprintBackupJson(getRequest(), data);
    });

export const readDashboardBlueprintBackupPageRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardBlueprintBackupPageInput)
    .handler(async ({ data }): Promise<DashboardBlueprintBackupPageResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardBlueprintBackupPage } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardBlueprintBackupPage(getRequest(), data);
    });

export const readDashboardBlueprintDriftRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintDriftInput)
    .handler(async ({ data }): Promise<DashboardBlueprintDriftResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardBlueprintDrift } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardBlueprintDrift(getRequest(), data);
    });

export const renameDashboardBlueprintBackupRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintBackupRenameInput)
    .handler(async ({ data }): Promise<DashboardBlueprintBackupRenameResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { renameDashboardBlueprintBackup } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return renameDashboardBlueprintBackup(getRequest(), data);
    });

export const importDashboardBlueprintBackupRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintBackupImportInput)
    .handler(async ({ data }): Promise<DashboardBlueprintBackupImportResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { importDashboardBlueprintBackup } = await import('./dashboard-blueprint-plans.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return importDashboardBlueprintBackup(getRequest(), data);
    });

export const deleteDashboardBlueprintBackupRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintBackupDeleteInput)
    .handler(async ({ data }): Promise<DashboardBlueprintBackupDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardBlueprintBackup } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardBlueprintBackup(getRequest(), data);
    });

export const saveDashboardBlueprintBackupSettingsRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintBackupSettingsInput)
    .handler(async ({ data }): Promise<DashboardBlueprintBackupSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { saveDashboardBlueprintBackupSettings } = await import('./dashboard-blueprint-backups.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return saveDashboardBlueprintBackupSettings(getRequest(), data);
    });

export const createDashboardBlueprintPlanRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintPlanInput)
    .handler(async ({ data }): Promise<DashboardBlueprintPlanResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { createDashboardBlueprintPlan } = await import('./dashboard-blueprint-plans.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return createDashboardBlueprintPlan(getRequest(), data);
    });

export const approveDashboardBlueprintPlanRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintApprovalInput)
    .handler(async ({ data }): Promise<DashboardBlueprintApprovalResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { approveDashboardBlueprintPlan } = await import('./dashboard-blueprint-plans.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return approveDashboardBlueprintPlan(getRequest(), data);
    });

export const createDashboardBlueprintRecoveryPlanRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintRecoveryInput)
    .handler(async ({ data }): Promise<DashboardBlueprintRecoveryResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { createDashboardBlueprintRecoveryPlan } = await import('./dashboard-blueprint-plans.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return createDashboardBlueprintRecoveryPlan(getRequest(), data);
    });

export const readDashboardBlueprintPlanStepPageRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardBlueprintPlanStepPageInput)
    .handler(async ({ data }): Promise<DashboardBlueprintPlanStepPageResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardBlueprintPlanStepPage } = await import('./dashboard-blueprint-runs.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return readDashboardBlueprintPlanStepPage(getRequest(), data);
    });

export const readDashboardBlueprintPlanDecisionPageRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardBlueprintDecisionPageInput)
    .handler(async ({ data }): Promise<DashboardBlueprintDecisionPageResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardBlueprintPlanDecisionPage } =
            await import('./dashboard-blueprint-plan-persistence.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return readDashboardBlueprintPlanDecisionPage(getRequest(), data);
    });

export const readDashboardBlueprintPlanAuthorityRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardBlueprintPlanAuthorityInput)
    .handler(async ({ data }): Promise<DashboardBlueprintPlanAuthorityResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardBlueprintPlanAuthority } = await import('./dashboard-blueprint-plan-detail.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return readDashboardBlueprintPlanAuthority(getRequest(), data);
    });

export const readDashboardBlueprintPreflightEvidenceRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardBlueprintPreflightEvidenceInput)
    .handler(async ({ data }): Promise<DashboardBlueprintPreflightEvidenceResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardBlueprintPreflightEvidence } = await import('./dashboard-blueprint-plan-detail.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return readDashboardBlueprintPreflightEvidence(getRequest(), data);
    });

export const readDashboardBlueprintVerificationEvidenceRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardBlueprintVerificationEvidenceInput)
    .handler(async ({ data }): Promise<DashboardBlueprintVerificationEvidenceResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { readDashboardBlueprintVerificationEvidence } =
            await import('./dashboard-blueprint-plan-detail.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return readDashboardBlueprintVerificationEvidence(getRequest(), data);
    });

export const preflightDashboardBlueprintPlanRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintPreflightInput)
    .handler(async ({ data }): Promise<DashboardBlueprintPreflightResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { preflightDashboardBlueprintPlan } = await import('./dashboard-blueprint-preflight.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return preflightDashboardBlueprintPlan(getRequest(), data);
    });

export const applyDashboardBlueprintPlanRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintApplyInput)
    .handler(async ({ data }): Promise<DashboardBlueprintApplyResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { applyDashboardBlueprintPlan } = await import('./dashboard-blueprint-apply.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return applyDashboardBlueprintPlan(getRequest(), data);
    });

export const controlDashboardBlueprintRunRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardBlueprintRunControlInput)
    .handler(async ({ data }): Promise<DashboardBlueprintRunControlResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { controlDashboardBlueprintRun } = await import('./dashboard-blueprint-apply.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return controlDashboardBlueprintRun(getRequest(), data);
    });

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') return { guildId: '' };

    return {
        guildId: readString((input as Record<string, unknown>).guildId),
    };
}

function validateDashboardBlueprintPlanAuthorityInput(input: unknown): DashboardBlueprintPlanAuthorityInput {
    if (!input || typeof input !== 'object') return { guildId: '', planId: '' };
    const payload = input as Record<string, unknown>;
    return { guildId: readString(payload.guildId), planId: readString(payload.planId) };
}

function validateDashboardBlueprintPreflightEvidenceInput(input: unknown): DashboardBlueprintPreflightEvidenceInput {
    const payload = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    return { guildId: readString(payload.guildId), preflightId: readString(payload.preflightId) };
}

function validateDashboardBlueprintVerificationEvidenceInput(
    input: unknown
): DashboardBlueprintVerificationEvidenceInput {
    const payload = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    return { guildId: readString(payload.guildId), runId: readString(payload.runId) };
}

export function validateDashboardBlueprintPlanInput(input: unknown): DashboardBlueprintPlanInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', backupJson: '', policy: '' as DashboardBlueprintPlanInput['policy'] };
    }

    const payload = input as Record<string, unknown>;

    const backupJson = readString(payload.backupJson);
    if (!isBlueprintSnapshotJsonWithinByteLimit(backupJson)) {
        throw new Error(
            `Server blueprint JSON cannot exceed ${String(BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes / 1024 / 1024)} MiB.`
        );
    }

    return {
        guildId: readString(payload.guildId),
        backupJson,
        policy: readString(payload.policy) as DashboardBlueprintPlanInput['policy'],
        roleMappings: readStringMap(payload.roleMappings),
        categoryMappings: readStringMap(payload.categoryMappings),
        channelMappings: readStringMap(payload.channelMappings),
    };
}

function validateDashboardBlueprintBackupJsonInput(input: unknown): { backupId: string; guildId: string } {
    if (!input || typeof input !== 'object') return { backupId: '', guildId: '' };

    const payload = input as Record<string, unknown>;

    return {
        backupId: readString(payload.backupId),
        guildId: readString(payload.guildId),
    };
}

function validateDashboardBlueprintBackupPageInput(input: unknown): DashboardBlueprintBackupPageInput {
    if (!input || typeof input !== 'object') return { guildId: '' };

    const payload = input as Record<string, unknown>;
    const limit = payload.limit;

    return {
        cursor: readString(payload.cursor) || undefined,
        guildId: readString(payload.guildId),
        limit: typeof limit === 'number' ? limit : undefined,
    };
}

function validateDashboardBlueprintDriftInput(input: unknown): DashboardBlueprintDriftInput {
    if (!input || typeof input !== 'object') return { guildId: '' };

    const payload = input as Record<string, unknown>;

    return {
        baselineBackupId: readString(payload.baselineBackupId) || undefined,
        guildId: readString(payload.guildId),
    };
}

function validateDashboardBlueprintBackupRenameInput(input: unknown): DashboardBlueprintBackupRenameInput {
    if (!input || typeof input !== 'object') return { backupId: '', guildId: '', name: '' };

    const payload = input as Record<string, unknown>;

    return {
        backupId: readString(payload.backupId),
        guildId: readString(payload.guildId),
        name: readString(payload.name),
    };
}

function validateDashboardBlueprintBackupDeleteInput(input: unknown): DashboardBlueprintBackupDeleteInput {
    if (!input || typeof input !== 'object') return { backupId: '', guildId: '' };

    const payload = input as Record<string, unknown>;

    return {
        backupId: readString(payload.backupId),
        guildId: readString(payload.guildId),
    };
}

function validateDashboardBlueprintBackupImportInput(input: unknown): DashboardBlueprintBackupImportInput {
    return validateDashboardBlueprintBackupDeleteInput(input);
}

function validateDashboardBlueprintBackupSettingsInput(input: unknown): DashboardBlueprintBackupSettingsInput {
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

function validateDashboardBlueprintApprovalInput(input: unknown): DashboardBlueprintApprovalInput {
    if (!input || typeof input !== 'object') return { guildId: '', planId: '', planDigest: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        planId: readString(payload.planId),
        planDigest: readString(payload.planDigest),
    };
}

function validateDashboardBlueprintRecoveryInput(input: unknown): DashboardBlueprintRecoveryInput {
    if (!input || typeof input !== 'object') return { guildId: '', planId: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        planId: readString(payload.planId),
    };
}

function validateDashboardBlueprintPlanStepPageInput(input: unknown): DashboardBlueprintPlanStepPageInput {
    if (!input || typeof input !== 'object') return { guildId: '', planId: '' };

    const payload = input as Record<string, unknown>;
    const limit = payload.limit;

    return {
        cursor: readString(payload.cursor) || undefined,
        guildId: readString(payload.guildId),
        planId: readString(payload.planId),
        limit: typeof limit === 'number' ? limit : undefined,
    };
}

function validateDashboardBlueprintDecisionPageInput(input: unknown): DashboardBlueprintDecisionPageInput {
    const payload = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    return {
        guildId: readString(payload.guildId),
        planId: readString(payload.planId),
        cursor: typeof payload.cursor === 'number' ? payload.cursor : undefined,
        limit: typeof payload.limit === 'number' ? payload.limit : undefined,
    };
}

function validateDashboardBlueprintPreflightInput(input: unknown): DashboardBlueprintPreflightInput {
    if (!input || typeof input !== 'object') return { guildId: '', planId: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        planId: readString(payload.planId),
    };
}

function validateDashboardBlueprintApplyInput(input: unknown): DashboardBlueprintApplyInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', planId: '', planDigest: '', preflightDigest: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        planId: readString(payload.planId),
        planDigest: readString(payload.planDigest),
        preflightDigest: readString(payload.preflightDigest),
        confirmation: readDashboardBlueprintConfirmation(payload.confirmation),
    };
}

function readDashboardBlueprintConfirmation(value: unknown): DashboardBlueprintApplyInput['confirmation'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const payload = value as Record<string, unknown>;
    const confirmation: NonNullable<DashboardBlueprintApplyInput['confirmation']> = {};
    if (payload.understandsDeletion === true) confirmation.understandsDeletion = true;
    if (payload.understandsRestorePointRequirement === true) confirmation.understandsRestorePointRequirement = true;
    if (typeof payload.targetGuildName === 'string') confirmation.targetGuildName = payload.targetGuildName;
    return confirmation;
}

export function validateDashboardBlueprintRunControlInput(input: unknown): DashboardBlueprintRunControlInput {
    const payload = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const request = payload.request;
    if (request !== 'pause' && request !== 'resume' && request !== 'cancel') {
        throw new Error('Run control request must be pause, resume, or cancel.');
    }

    return {
        guildId: readString(payload.guildId),
        planId: readString(payload.planId),
        runId: readString(payload.runId),
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
