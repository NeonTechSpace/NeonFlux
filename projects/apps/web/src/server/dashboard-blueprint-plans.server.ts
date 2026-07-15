import '@tanstack/react-start/server-only';

import {
    approveBlueprintPlan,
    findStructureBackupByGuildId,
    getBlueprintPlanMetadata,
    blueprintAuditActions,
    blueprintPlanStatuses,
} from '@neonflux/db';

import { readDashboardBotGuildStructure } from './bot-read-client.server.js';
import { getWebDb } from './db.server.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import { toDashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import { isDashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';
import type { DashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';
import type {
    DashboardBlueprintApprovalInput,
    DashboardBlueprintApprovalResult,
    DashboardBlueprintBackupImportInput,
    DashboardBlueprintBackupImportResult,
    DashboardBlueprintPlanInput,
    DashboardBlueprintPlanResult,
    DashboardBlueprintRecoveryInput,
    DashboardBlueprintRecoveryResult,
} from './dashboard-blueprint-model.js';
import { persistDashboardBlueprintPlan } from './dashboard-blueprint-plan-persistence.server.js';
import {
    createBlueprintAuditPayload,
    mapRepositoryError,
    toDashboardBlueprintPlan,
} from './dashboard-blueprint-records.server.js';
import {
    createDashboardBlueprintRecoveryMetadata,
    loadDashboardBlueprintRecoverySource,
} from './dashboard-blueprint-recovery.server.js';
import {
    mapBotStructureReadError,
    normalizeDashboardBlueprintPayload,
    parseDashboardBlueprintSnapshot,
    tryDiffDashboardBlueprintSnapshot,
} from './dashboard-blueprint-snapshot-planning.server.js';

export async function importDashboardBlueprintBackup(
    request: Request,
    input: DashboardBlueprintBackupImportInput
): Promise<DashboardBlueprintBackupImportResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
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
    const requestedResult = normalizeDashboardBlueprintPayload(backupResult.value.structure);
    if (requestedResult.type === 'invalid-input') return requestedResult;
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) return mapBotStructureReadError(currentResult.error);
    const planResult = tryDiffDashboardBlueprintSnapshot(
        toDashboardBlueprintSnapshot(currentResult.value),
        requestedResult.snapshot,
        { policy: 'synchronize' }
    );
    if (planResult.type !== 'valid') return planResult;
    const plan = planResult.plan;
    const persistedPlan = await persistDashboardBlueprintPlan(context, plan, requestedResult.snapshot, {
        policy: 'synchronize',
        audit: (planId) =>
            createBlueprintAuditPayload(context, blueprintAuditActions.backupImportCreated, backupResult.value.id, {
                changeCount: plan.changes.length,
                planId,
            }),
        source: 'backup',
        sourceBackupId: backupResult.value.id,
    });
    return persistedPlan.type === 'plan-created'
        ? { type: 'backup-import-created', plan: persistedPlan.plan }
        : persistedPlan;
}

export async function createDashboardBlueprintPlan(
    request: Request,
    input: DashboardBlueprintPlanInput
): Promise<DashboardBlueprintPlanResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const requestedResult = parseDashboardBlueprintSnapshot(input.backupJson);
    if (requestedResult.type === 'invalid-input') return requestedResult;
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) return mapBotStructureReadError(currentResult.error);
    if (!isDashboardBlueprintPolicy(input.policy)) {
        return { type: 'invalid-input', message: 'Choose how this blueprint should own the target server.' };
    }
    const policy = input.policy;
    const planResult = tryDiffDashboardBlueprintSnapshot(
        toDashboardBlueprintSnapshot(currentResult.value),
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
    return persistDashboardBlueprintPlan(context, plan, requestedResult.snapshot, {
        audit: (planId) =>
            createBlueprintAuditPayload(context, blueprintAuditActions.planCreated, planId, {
                changeCount: plan.changes.length,
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

export async function approveDashboardBlueprintPlan(
    request: Request,
    input: DashboardBlueprintApprovalInput
): Promise<DashboardBlueprintApprovalResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const planId = input.planId.trim();
    if (!planId) return { type: 'invalid-input', message: 'Choose a deployment plan to approve.' };
    const database = await getWebDb();
    const planResult = await getBlueprintPlanMetadata(database.db, {
        guildId: context.guild.id,
        planId: planId,
    });
    if (planResult.isErr()) return mapRepositoryError(planResult.error);
    if (planResult.value.status !== blueprintPlanStatuses.reviewReady) {
        return { type: 'not-approvable', status: planResult.value.status };
    }
    const planDigest = planResult.value.planDigest;
    if (!planDigest || input.planDigest !== planDigest) return { type: 'plan-digest-mismatch' };
    if (planResult.value.blockerCount > 0) {
        return { type: 'invalid-input', message: 'Resolve every blocked blueprint decision before approval.' };
    }
    const summary = planResult.value.summary;
    const approvedAt = new Date();
    const approvalResult = await approveBlueprintPlan(database.db, {
        planId: planId,
        planDigest,
        approvedByUserId: context.actor.actorUserId,
        approvedAt,
        deleteSetDigest: null,
        destructiveStepCount: null,
        destructiveApprovedAt: null,
        destructivePreflightDigest: null,
        audit: createBlueprintAuditPayload(context, blueprintAuditActions.planApproved, planId, {
            stepCount: planResult.value.stepCount,
            createCount: summary.creates,
            updateCount: summary.updates,
            deleteCount: summary.deletes,
        }),
    });
    if (approvalResult.isErr()) return mapRepositoryError(approvalResult.error);
    return {
        type: 'approved',
        plan: toDashboardBlueprintPlan({
            ...planResult.value,
            status: blueprintPlanStatuses.approved,
            updatedAt: approvedAt,
        }),
    };
}

export async function createDashboardBlueprintRecoveryPlan(
    request: Request,
    input: DashboardBlueprintRecoveryInput
): Promise<DashboardBlueprintRecoveryResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const planId = input.planId.trim();
    if (!planId) return { type: 'invalid-input', message: 'Choose a deployment that needs reconciliation.' };
    const recoverySource = await loadDashboardBlueprintRecoverySource(context.guild.id, planId);
    if (recoverySource.type !== 'source') return recoverySource;
    const { detail: sourceDetail, run: sourceRun } = recoverySource;
    const sourcePlan = sourceDetail.plan;
    const requestedSnapshot = sourceDetail.authority.requestedSnapshot;
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) return mapBotStructureReadError(currentResult.error);
    const policy: DashboardBlueprintPolicy = 'synchronize';
    const roleMappings = sourceDetail.authority.mappings.roles;
    const categoryMappings = sourceDetail.authority.mappings.categories;
    const channelMappings = sourceDetail.authority.mappings.channels;
    const planResult = tryDiffDashboardBlueprintSnapshot(
        toDashboardBlueprintSnapshot(currentResult.value),
        requestedSnapshot,
        { policy, roleMappings, categoryMappings, channelMappings }
    );
    if (planResult.type !== 'valid') return planResult;
    const recoveryResult = await persistDashboardBlueprintPlan(context, planResult.plan, requestedSnapshot, {
        policy,
        roleMappings,
        categoryMappings,
        channelMappings,
        planMetadata: createDashboardBlueprintRecoveryMetadata(sourcePlan.id, sourceRun.id),
        source: 'dashboard-recovery-plan',
        ...(sourcePlan.sourceBackupId ? { sourceBackupId: sourcePlan.sourceBackupId } : {}),
    });
    return recoveryResult.type === 'plan-created'
        ? { type: 'recovery-plan-created', plan: recoveryResult.plan }
        : recoveryResult;
}
