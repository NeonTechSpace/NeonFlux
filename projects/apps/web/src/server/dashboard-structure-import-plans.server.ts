import '@tanstack/react-start/server-only';

import {
    approveStructureImportPlan,
    findStructureBackupByGuildId,
    findStructureImportRunWithActionsByGuildId,
    structureAuditActions,
    structureImportRunStatuses,
} from '@neonflux/db';

import { readDashboardBotGuildStructure } from './bot-read-client.server.js';
import { getWebDb } from './db.server.js';
import {
    readPersistedCategoryMappings,
    readPersistedChannelMappings,
    readPersistedRoleMappings,
} from './dashboard-structure-apply-plan.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import { toDashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { isDashboardStructurePolicy } from './dashboard-structure-contracts.js';
import type { DashboardStructurePolicy } from './dashboard-structure-contracts.js';
import type {
    DashboardStructureApprovalInput,
    DashboardStructureApprovalResult,
    DashboardStructureBackupImportInput,
    DashboardStructureBackupImportResult,
    DashboardStructurePlanInput,
    DashboardStructurePlanResult,
    DashboardStructureRecoveryInput,
    DashboardStructureRecoveryResult,
} from './dashboard-structure-model.js';
import { persistDashboardStructureImportPlan } from './dashboard-structure-plan-persistence.server.js';
import {
    createStructureAuditPayload,
    mapRepositoryError,
    readPolicy,
    readRequestedSnapshot,
    summarizeActions,
    toDashboardImportRun,
} from './dashboard-structure-records.server.js';
import {
    createDashboardStructureRecoveryMetadata,
    loadDashboardStructureRecoverySource,
} from './dashboard-structure-recovery.server.js';
import {
    mapBotStructureReadError,
    normalizeDashboardStructurePayload,
    parseDashboardStructureSnapshot,
    tryDiffDashboardStructureSnapshot,
} from './dashboard-structure-snapshot-planning.server.js';

export async function importDashboardStructureBackup(
    request: Request,
    input: DashboardStructureBackupImportInput
): Promise<DashboardStructureBackupImportResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const backupId = input.backupId.trim();
    if (!backupId) return { type: 'invalid-input', message: 'Choose a backup to import.' };
    const database = await getWebDb();
    const backupResult = await findStructureBackupByGuildId(database.db, {
        backupId,
        guildId: context.guild.id,
    });
    if (backupResult.isErr()) return mapRepositoryError(backupResult.error);
    if (!backupResult.value.structure) return { type: 'backup-json-unavailable' };
    const requestedResult = normalizeDashboardStructurePayload(backupResult.value.structure);
    if (requestedResult.type === 'invalid-input') return requestedResult;
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) return mapBotStructureReadError(currentResult.error);
    const planResult = tryDiffDashboardStructureSnapshot(
        toDashboardStructureSnapshot(currentResult.value),
        requestedResult.snapshot,
        { policy: 'synchronize' }
    );
    if (planResult.type !== 'valid') return planResult;
    const plan = planResult.plan;
    const runResult = await persistDashboardStructureImportPlan(context, plan, requestedResult.snapshot, {
        policy: 'synchronize',
        audit: (importRunId) =>
            createStructureAuditPayload(context, structureAuditActions.backupImportCreated, backupResult.value.id, {
                actionCount: plan.actions.length,
                importRunId,
            }),
        source: 'backup',
        sourceBackupId: backupResult.value.id,
    });
    return runResult.type === 'plan-created'
        ? { type: 'backup-import-created', importRun: runResult.importRun }
        : runResult;
}

export async function createDashboardStructureImportPlan(
    request: Request,
    input: DashboardStructurePlanInput
): Promise<DashboardStructurePlanResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const requestedResult = parseDashboardStructureSnapshot(input.backupJson);
    if (requestedResult.type === 'invalid-input') return requestedResult;
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) return mapBotStructureReadError(currentResult.error);
    if (!isDashboardStructurePolicy(input.policy)) {
        return { type: 'invalid-input', message: 'Choose how this blueprint should own the target server.' };
    }
    const policy = input.policy;
    const planResult = tryDiffDashboardStructureSnapshot(
        toDashboardStructureSnapshot(currentResult.value),
        requestedResult.snapshot,
        {
            policy,
            roleMappings: input.roleMappings,
            categoryMappings: input.categoryMappings,
            channelMappings: input.channelMappings,
        }
    );
    if (planResult.type !== 'valid') return planResult;
    const plan = planResult.plan;
    return persistDashboardStructureImportPlan(context, plan, requestedResult.snapshot, {
        audit: (importRunId) =>
            createStructureAuditPayload(context, structureAuditActions.importPlanCreated, importRunId, {
                actionCount: plan.actions.length,
                createCount: plan.summary.creates,
                updateCount: plan.summary.updates,
                deleteCount: plan.summary.deletes,
                policy,
            }),
        policy,
        roleMappings: input.roleMappings,
        categoryMappings: input.categoryMappings,
        channelMappings: input.channelMappings,
    });
}

export async function approveDashboardStructurePlan(
    request: Request,
    input: DashboardStructureApprovalInput
): Promise<DashboardStructureApprovalResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const importRunId = input.importRunId.trim();
    if (!importRunId) return { type: 'invalid-input', message: 'Choose a deployment plan to approve.' };
    const database = await getWebDb();
    const importRunResult = await findStructureImportRunWithActionsByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });
    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);
    if (importRunResult.value.status !== structureImportRunStatuses.reviewReady) {
        return { type: 'not-approvable', status: importRunResult.value.status };
    }
    const planDigest = importRunResult.value.planDigest;
    if (!planDigest || input.planDigest !== planDigest) return { type: 'plan-digest-mismatch' };
    const blockers = Array.isArray(importRunResult.value.plan.blockers) ? importRunResult.value.plan.blockers : [];
    if (blockers.length > 0) {
        return { type: 'invalid-input', message: 'Resolve every blocked blueprint decision before approval.' };
    }
    const summary = summarizeActions(importRunResult.value.actions);
    const approvedAt = new Date();
    const approvalResult = await approveStructureImportPlan(database.db, {
        runId: importRunId,
        planDigest,
        approvedByUserId: context.actor.actorUserId,
        approvedAt,
        deleteSetDigest: null,
        destructiveActionCount: null,
        destructiveApprovedAt: null,
        destructivePreflightDigest: null,
        audit: createStructureAuditPayload(context, structureAuditActions.importPlanApproved, importRunId, {
            actionCount: importRunResult.value.actions.length,
            createCount: summary.creates,
            updateCount: summary.updates,
            deleteCount: summary.deletes,
        }),
    });
    if (approvalResult.isErr()) return mapRepositoryError(approvalResult.error);
    return {
        type: 'approved',
        importRun: toDashboardImportRun({
            ...importRunResult.value,
            status: structureImportRunStatuses.approved,
            updatedAt: approvedAt,
            actions: importRunResult.value.actions,
        }),
    };
}

export async function createDashboardStructureRecoveryPlan(
    request: Request,
    input: DashboardStructureRecoveryInput
): Promise<DashboardStructureRecoveryResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const importRunId = input.importRunId.trim();
    if (!importRunId) return { type: 'invalid-input', message: 'Choose a deployment that needs reconciliation.' };
    const recoverySource = await loadDashboardStructureRecoverySource(context.guild.id, importRunId);
    if (recoverySource.type !== 'source') return recoverySource;
    const { run: sourceRun, execution: sourceExecution } = recoverySource;
    const requestedSnapshot = readRequestedSnapshot(sourceRun.plan);
    if (!requestedSnapshot) return { type: 'invalid-input', message: 'This run has no source snapshot.' };
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) return mapBotStructureReadError(currentResult.error);
    if (!readPolicy(sourceRun.plan)) {
        return { type: 'invalid-input', message: 'This run is not a current Server Blueprint plan.' };
    }
    const policy: DashboardStructurePolicy = 'synchronize';
    const roleMappings = readPersistedRoleMappings(sourceRun.plan);
    const categoryMappings = readPersistedCategoryMappings(sourceRun.plan);
    const channelMappings = readPersistedChannelMappings(sourceRun.plan);
    const planResult = tryDiffDashboardStructureSnapshot(
        toDashboardStructureSnapshot(currentResult.value),
        requestedSnapshot,
        { policy, roleMappings, categoryMappings, channelMappings }
    );
    if (planResult.type !== 'valid') return planResult;
    const recoveryResult = await persistDashboardStructureImportPlan(context, planResult.plan, requestedSnapshot, {
        policy,
        roleMappings,
        categoryMappings,
        channelMappings,
        planMetadata: createDashboardStructureRecoveryMetadata(sourceRun.id, sourceExecution.id),
        source: 'dashboard-recovery-plan',
        ...(sourceRun.sourceBackupId ? { sourceBackupId: sourceRun.sourceBackupId } : {}),
    });
    return recoveryResult.type === 'plan-created'
        ? { type: 'recovery-plan-created', importRun: recoveryResult.importRun }
        : recoveryResult;
}
