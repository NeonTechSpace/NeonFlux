import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import { recordBotActionEventInMutation } from '../core/events.js';
import type {
    StoredReactionRolePanel,
    StoredReactionRoleSelectionSnapshot,
    StoredReactionRoleVersion,
} from './reaction_role_model.js';
import {
    reactionRolePanelCompletionResultValidator,
    reactionRolePanelOperationStepValidator,
    reactionRolePanelWorkerRecordValidator,
} from './reaction_role_validators.js';

const botService = ['bot'] as const;
const maxClaimCandidates = 25;

type PanelOperation = {
    _id: GenericId<'reactionRolePanelOperations'>;
    actorUserId: string;
    attemptCount: number;
    createdAt: string;
    deleteMessage?: boolean;
    errorCode?: string;
    generation?: number;
    guildId: string;
    leaseExpiresAt?: string;
    leaseId?: string;
    leaseOwner?: string;
    messageId?: string;
    nonce: string;
    nextAttemptAt?: string;
    panelId: GenericId<'reactionRolePanels'>;
    requestKey: string;
    revokeOwnedRoles?: boolean;
    status: 'queued' | 'running' | 'unknown' | 'completed' | 'permanent_failure';
    step:
        | 'queued'
        | 'message_send_started'
        | 'message_recorded'
        | 'reactions_seeded'
        | 'message_updated'
        | 'cleanup_started'
        | 'cleanup_completed'
        | 'completed';
    targetVersionId: GenericId<'reactionRolePanelVersions'>;
    type: 'publish' | 'update' | 'deactivate';
    updatedAt: string;
};

export const claimNextReactionRolePanelOperation = mutation({
    args: {
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
    },
    returns: v.union(reactionRolePanelWorkerRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const nowMs = Date.parse(args.now);
        const leaseExpiryMs = Date.parse(args.leaseExpiresAt);
        if (!Number.isFinite(nowMs) || !Number.isFinite(leaseExpiryMs) || leaseExpiryMs <= nowMs) {
            throw new Error('reaction-role-lease-window-invalid');
        }
        const candidates = await findClaimCandidates(ctx, args.now);
        for (const candidate of candidates) {
            const panel = (await ctx.db.get('reactionRolePanels', candidate.panelId)) as StoredReactionRolePanel | null;
            const generation = candidate.generation ?? panel?.generation;
            if (!panel || generation === undefined || !isPanelOperationCurrent(panel, candidate, generation)) {
                await ctx.db.patch('reactionRolePanelOperations', candidate._id, {
                    errorCode: 'panel_operation_stale',
                    leaseExpiresAt: undefined,
                    leaseId: undefined,
                    leaseOwner: undefined,
                    nextAttemptAt: undefined,
                    status: 'permanent_failure',
                    updatedAt: args.now,
                });
                continue;
            }
            await ctx.db.patch('reactionRolePanelOperations', candidate._id, {
                attemptCount: candidate.attemptCount + 1,
                errorCode: undefined,
                generation,
                leaseExpiresAt: args.leaseExpiresAt,
                leaseId: args.leaseId,
                leaseOwner: args.leaseOwner,
                nextAttemptAt: undefined,
                status: 'running',
                updatedAt: args.now,
            });
            const claimed = (await ctx.db.get('reactionRolePanelOperations', candidate._id)) as PanelOperation | null;
            return claimed ? await toWorkerRecord(ctx, claimed) : null;
        }
        return null;
    },
});

export const readReactionRolePanelOperationForWorker = query({
    args: {
        operationId: v.string(),
    },
    returns: v.union(reactionRolePanelWorkerRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = (await ctx.db.get(
            'reactionRolePanelOperations',
            args.operationId as GenericId<'reactionRolePanelOperations'>
        )) as PanelOperation | null;
        return operation ? await toWorkerRecord(ctx, operation) : null;
    },
});

export const renewReactionRolePanelOperationLease = mutation({
    args: {
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const leaseExpiryMs = Date.parse(args.leaseExpiresAt);
        const nowMs = Date.parse(args.now);
        if (!Number.isFinite(leaseExpiryMs) || !Number.isFinite(nowMs) || leaseExpiryMs <= nowMs) {
            throw new Error('reaction-role-lease-window-invalid');
        }
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return false;
        await ctx.db.patch('reactionRolePanelOperations', operation._id, {
            leaseExpiresAt: args.leaseExpiresAt,
            updatedAt: args.now,
        });
        return true;
    },
});

export const advanceReactionRolePanelOperation = mutation({
    args: {
        leaseId: v.string(),
        messageId: v.optional(v.string()),
        now: v.string(),
        operationId: v.string(),
        step: reactionRolePanelOperationStepValidator,
    },
    returns: v.union(reactionRolePanelWorkerRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return null;
        if (operation.messageId && args.messageId && operation.messageId !== args.messageId) {
            throw new Error('reaction-role-external-message-conflict');
        }
        const panel = (await ctx.db.get('reactionRolePanels', operation.panelId)) as StoredReactionRolePanel | null;
        if (!panel) return null;
        await ctx.db.patch('reactionRolePanelOperations', operation._id, {
            attemptCount: 0,
            ...(args.messageId ? { messageId: args.messageId } : {}),
            step: args.step,
            updatedAt: args.now,
        });
        if (args.messageId) {
            if (panel.messageId && panel.messageId !== args.messageId) {
                throw new Error('reaction-role-panel-message-conflict');
            }
            await ctx.db.patch('reactionRolePanels', panel._id, {
                messageId: args.messageId,
                updatedAt: args.now,
            });
        }
        const updated = (await ctx.db.get('reactionRolePanelOperations', operation._id)) as PanelOperation | null;
        return updated ? await toWorkerRecord(ctx, updated) : null;
    },
});

export const deferReactionRolePanelOperation = mutation({
    args: {
        errorCode: v.string(),
        leaseId: v.string(),
        nextAttemptAt: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return false;
        if (Date.parse(args.nextAttemptAt) <= Date.parse(args.now)) {
            throw new Error('reaction-role-retry-window-invalid');
        }
        await ctx.db.patch('reactionRolePanelOperations', operation._id, {
            errorCode: args.errorCode,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: args.nextAttemptAt,
            status: 'queued',
            updatedAt: args.now,
        });
        return true;
    },
});

export const pauseReactionRolePanelOperation = mutation({
    args: {
        leaseId: v.string(),
        nextAttemptAt: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return false;
        if (Date.parse(args.nextAttemptAt) <= Date.parse(args.now)) {
            throw new Error('reaction-role-retry-window-invalid');
        }
        await ctx.db.patch('reactionRolePanelOperations', operation._id, {
            attemptCount: Math.max(0, operation.attemptCount - 1),
            errorCode: 'defcon_paused',
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: args.nextAttemptAt,
            status: 'queued',
            updatedAt: args.now,
        });
        return true;
    },
});

export const yieldReactionRolePanelOperation = mutation({
    args: {
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return false;
        await ctx.db.patch('reactionRolePanelOperations', operation._id, {
            attemptCount: 0,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: undefined,
            status: 'queued',
            updatedAt: args.now,
        });
        return true;
    },
});

export const failReactionRolePanelOperation = mutation({
    args: {
        errorCode: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
        unknown: v.boolean(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return false;
        const status = args.unknown ? 'unknown' : 'permanent_failure';
        await ctx.db.patch('reactionRolePanelOperations', operation._id, {
            errorCode: args.errorCode,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: undefined,
            status,
            updatedAt: args.now,
        });
        await ctx.db.patch('reactionRolePanels', operation.panelId, {
            errorCode: args.errorCode,
            status: args.unknown ? 'unknown' : 'degraded',
            updatedAt: args.now,
        });
        await recordBotActionEventInMutation(ctx, {
            action: args.unknown ? 'reaction_roles.panel.outcome_unknown' : 'reaction_roles.panel.operation_failed',
            feature: 'reaction_roles',
            guildId: operation.guildId,
            metadata: {
                errorCode: args.errorCode,
                operationId: operation._id,
                operationType: operation.type,
            },
            targetId: operation.panelId,
        });
        return true;
    },
});

export const completeReactionRolePanelOperation = mutation({
    args: {
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: reactionRolePanelCompletionResultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return 'stale' as const;
        const panel = (await ctx.db.get('reactionRolePanels', operation.panelId)) as StoredReactionRolePanel | null;
        if (!panel) return 'stale' as const;
        const targetVersion = (await ctx.db.get(
            'reactionRolePanelVersions',
            operation.targetVersionId
        )) as StoredReactionRoleVersion | null;
        if (!targetVersion) return 'stale' as const;

        if (operation.type !== 'publish') {
            const dirty = (
                await ctx.db
                    .query('reactionRoleReconciliationDirtyUsers')
                    .withIndex('by_panel_updated', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
                    .take(1)
            )[0];
            if (dirty) {
                await ctx.db.delete('reactionRoleReconciliationDirtyUsers', dirty._id);
                return 'pending' as const;
            }
        }
        if (operation.type === 'update') {
            if (await reconcileNextSelectionUserForVersionChange(ctx, panel, targetVersion, args.now)) {
                return 'pending' as const;
            }
        } else if (operation.type === 'deactivate') {
            if (await retireNextPanelSelectionUser(ctx, panel, operation.revokeOwnedRoles === true, args.now)) {
                return 'pending' as const;
            }
        }

        await ctx.db.patch('reactionRolePanelOperations', operation._id, {
            errorCode: undefined,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: undefined,
            status: 'completed',
            step: 'completed',
            updatedAt: args.now,
        });
        await ctx.db.patch('reactionRolePanels', panel._id, {
            ...(operation.type === 'deactivate' ? {} : { appliedVersionId: targetVersion._id }),
            ...(operation.type === 'deactivate' && operation.deleteMessage ? { messageId: undefined } : {}),
            errorCode: undefined,
            mode: targetVersion.payload.mode,
            reconciliationId: undefined,
            status: operation.type === 'deactivate' ? 'inactive' : 'active',
            updatedAt: args.now,
        });
        await recordBotActionEventInMutation(ctx, {
            action:
                operation.type === 'publish'
                    ? 'reaction_roles.panel.published'
                    : operation.type === 'update'
                      ? 'reaction_roles.panel.updated'
                      : 'reaction_roles.panel.deactivated',
            actorUserId: operation.actorUserId,
            feature: 'reaction_roles',
            guildId: operation.guildId,
            metadata: {
                operationId: operation._id,
                optionCount: targetVersion.payload.options.length,
                version: targetVersion.version,
            },
            targetId: panel._id,
        });
        return 'completed' as const;
    },
});

async function reconcileNextSelectionUserForVersionChange(
    ctx: MutationCtx,
    panel: StoredReactionRolePanel,
    target: StoredReactionRoleVersion,
    now: string
): Promise<boolean> {
    const stale = (
        await ctx.db
            .query('reactionRoleSelections')
            .withIndex('by_panel_generation', (queryBuilder) =>
                queryBuilder.eq('panelId', panel._id).lt('generation', panel.generation)
            )
            .take(1)
    )[0];
    if (!stale) return false;
    const userSelections = await ctx.db
        .query('reactionRoleSelections')
        .withIndex('by_panel_user', (queryBuilder) => queryBuilder.eq('panelId', panel._id).eq('userId', stale.userId))
        .collect();
    const appliedVersion = panel.appliedVersionId
        ? ((await ctx.db.get('reactionRolePanelVersions', panel.appliedVersionId)) as StoredReactionRoleVersion | null)
        : null;
    const orderedValid = target.payload.options.flatMap((option) => {
        const selection = userSelections.find((candidate) => candidate.optionId === option.id);
        return selection ? [{ option, selection }] : [];
    });
    const retained =
        target.payload.mode === 'exclusive' && orderedValid.length > 1 ? orderedValid.slice(0, 1) : orderedValid;
    const retainedIds = new Set(retained.map(({ selection }) => selection._id));
    const previous = userSelections.map((selection) =>
        selectionSnapshotFromDocument(selection, [appliedVersion, target])
    );
    const desired: StoredReactionRoleSelectionSnapshot[] = [];

    for (const selection of userSelections) {
        if (!retainedIds.has(selection._id)) {
            await ctx.db.delete('reactionRoleSelections', selection._id);
        }
    }
    for (const { option, selection } of retained) {
        const roleChanged = option.roleId !== selection.roleId;
        await ctx.db.patch('reactionRoleSelections', selection._id, {
            emojiKey: option.emojiKey,
            generation: panel.generation,
            grantOwnership: roleChanged ? 'pending' : selection.grantOwnership,
            revision: selection.revision + 1,
            roleId: option.roleId,
            updatedAt: now,
        });
        desired.push({
            emoji: option.emoji,
            grantOwnership: roleChanged ? 'pending' : selection.grantOwnership,
            optionId: option.id,
            roleId: option.roleId,
        });
    }
    if (!sameSelectionSnapshots(previous, desired)) {
        await upsertMemberOperation(ctx, {
            desired,
            guildId: panel.guildId,
            panelGeneration: panel.generation,
            panelId: panel._id,
            previous,
            userId: stale.userId,
            now,
        });
    }
    return true;
}

async function retireNextPanelSelectionUser(
    ctx: MutationCtx,
    panel: StoredReactionRolePanel,
    revokeOwnedRoles: boolean,
    now: string
): Promise<boolean> {
    const first = (
        await ctx.db
            .query('reactionRoleSelections')
            .withIndex('by_panel_user', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
            .take(1)
    )[0];
    if (!first) return false;
    const userSelections = await ctx.db
        .query('reactionRoleSelections')
        .withIndex('by_panel_user', (queryBuilder) => queryBuilder.eq('panelId', panel._id).eq('userId', first.userId))
        .collect();
    const version = panel.desiredVersionId
        ? ((await ctx.db.get('reactionRolePanelVersions', panel.desiredVersionId)) as StoredReactionRoleVersion | null)
        : null;
    const previous = userSelections.map((selection) => selectionSnapshotFromDocument(selection, [version]));
    for (const selection of userSelections) await ctx.db.delete('reactionRoleSelections', selection._id);
    if (revokeOwnedRoles) {
        await upsertMemberOperation(ctx, {
            desired: [],
            guildId: panel.guildId,
            panelGeneration: panel.generation,
            panelId: panel._id,
            previous,
            userId: first.userId,
            now,
        });
    }
    return true;
}

async function upsertMemberOperation(
    ctx: MutationCtx,
    input: {
        desired: StoredReactionRoleSelectionSnapshot[];
        guildId: string;
        now: string;
        panelGeneration: number;
        panelId: GenericId<'reactionRolePanels'>;
        previous: StoredReactionRoleSelectionSnapshot[];
        userId: string;
    }
): Promise<void> {
    const existing = await ctx.db
        .query('reactionRoleMemberOperations')
        .withIndex('by_panel_user', (queryBuilder) =>
            queryBuilder.eq('panelId', input.panelId).eq('userId', input.userId)
        )
        .unique();
    const addedOptionIds = input.desired
        .filter((desired) => !input.previous.some((previous) => previous.optionId === desired.optionId))
        .map((selection) => selection.optionId);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
        await ctx.db.patch('reactionRoleMemberOperations', existing._id, {
            addedOptionIds,
            desiredSelections: input.desired,
            panelGeneration: input.panelGeneration,
            previousSelections: existing.previousSelections,
            rerunRequested: existing.status === 'running',
            revision: existing.revision + 1,
            updatedAt: input.now,
        });
        return;
    }
    if (existing) {
        await ctx.db.patch('reactionRoleMemberOperations', existing._id, {
            addedOptionIds,
            attemptCount: 0,
            baselineRoleIds: undefined,
            desiredSelections: input.desired,
            errorCode: undefined,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: undefined,
            panelGeneration: input.panelGeneration,
            previousSelections: input.previous,
            rerunRequested: false,
            revision: existing.revision + 1,
            status: 'queued',
            updatedAt: input.now,
        });
        return;
    }
    await ctx.db.insert('reactionRoleMemberOperations', {
        addedOptionIds,
        attemptCount: 0,
        createdAt: input.now,
        desiredSelections: input.desired,
        guildId: input.guildId,
        panelGeneration: input.panelGeneration,
        panelId: input.panelId,
        previousSelections: input.previous,
        rerunRequested: false,
        revision: 1,
        status: 'queued',
        updatedAt: input.now,
        userId: input.userId,
    });
}

function selectionSnapshotFromDocument(
    selection: {
        grantOwnership: 'panel' | 'preexisting' | 'pending';
        optionId: string;
        roleId: string;
    },
    versions: ReadonlyArray<StoredReactionRoleVersion | null>
): StoredReactionRoleSelectionSnapshot {
    const option = versions
        .filter((version): version is StoredReactionRoleVersion => version !== null)
        .flatMap((version) => version.payload.options)
        .find((candidate) => candidate.id === selection.optionId && candidate.roleId === selection.roleId);
    if (!option) {
        throw new Error(`reaction-role-selection-version-mismatch:${selection.optionId}:${selection.roleId}`);
    }
    return {
        emoji: option.emoji,
        grantOwnership: selection.grantOwnership,
        optionId: selection.optionId,
        roleId: selection.roleId,
    };
}

function sameSelectionSnapshots(
    left: readonly StoredReactionRoleSelectionSnapshot[],
    right: readonly StoredReactionRoleSelectionSnapshot[]
): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function findClaimCandidates(ctx: MutationCtx, now: string): Promise<PanelOperation[]> {
    const queued = (await ctx.db
        .query('reactionRolePanelOperations')
        .withIndex('by_status_next_attempt', (queryBuilder) => queryBuilder.eq('status', 'queued'))
        .take(maxClaimCandidates)) as PanelOperation[];
    const expired = (await ctx.db
        .query('reactionRolePanelOperations')
        .withIndex('by_status_lease_expiry', (queryBuilder) =>
            queryBuilder.eq('status', 'running').lt('leaseExpiresAt', now)
        )
        .take(maxClaimCandidates)) as PanelOperation[];
    return [
        ...queued.filter((operation) => !operation.nextAttemptAt || operation.nextAttemptAt <= now),
        ...expired,
    ].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

function isPanelOperationCurrent(
    panel: StoredReactionRolePanel,
    operation: PanelOperation,
    generation: number
): boolean {
    const expectedStatus =
        operation.type === 'publish' ? 'publishing' : operation.type === 'update' ? 'updating' : 'deactivating';
    return (
        panel.generation === generation &&
        panel.status === expectedStatus &&
        panel.desiredVersionId === operation.targetVersionId
    );
}

async function requireLeasedOperation(
    ctx: MutationCtx,
    operationId: string,
    leaseId: string,
    now: string
): Promise<PanelOperation | null> {
    const operation = (await ctx.db.get(
        'reactionRolePanelOperations',
        operationId as GenericId<'reactionRolePanelOperations'>
    )) as PanelOperation | null;
    if (
        operation?.status !== 'running' ||
        operation.leaseId !== leaseId ||
        !operation.leaseExpiresAt ||
        Date.parse(operation.leaseExpiresAt) <= Date.parse(now)
    ) {
        return null;
    }
    const panel = (await ctx.db.get('reactionRolePanels', operation.panelId)) as StoredReactionRolePanel | null;
    if (
        !panel ||
        operation.generation === undefined ||
        !isPanelOperationCurrent(panel, operation, operation.generation)
    ) {
        return null;
    }
    return operation;
}

async function toWorkerRecord(ctx: QueryCtx | MutationCtx, operation: PanelOperation) {
    const panel = (await ctx.db.get('reactionRolePanels', operation.panelId)) as StoredReactionRolePanel | null;
    const target = (await ctx.db.get(
        'reactionRolePanelVersions',
        operation.targetVersionId
    )) as StoredReactionRoleVersion | null;
    const previous =
        panel?.appliedVersionId && panel.appliedVersionId !== operation.targetVersionId
            ? ((await ctx.db.get(
                  'reactionRolePanelVersions',
                  panel.appliedVersionId
              )) as StoredReactionRoleVersion | null)
            : null;
    if (!panel || !target) throw new Error('reaction-role-worker-record-invalid');
    return {
        attemptCount: operation.attemptCount,
        channelId: panel.channelId,
        createdAt: operation.createdAt,
        deleteMessage: operation.deleteMessage === true,
        errorCode: operation.errorCode ?? null,
        generation: operation.generation ?? panel.generation,
        guildId: operation.guildId,
        id: operation._id,
        leaseExpiresAt: operation.leaseExpiresAt ?? null,
        leaseId: operation.leaseId ?? null,
        leaseOwner: operation.leaseOwner ?? null,
        messageId: operation.messageId ?? panel.messageId ?? null,
        nonce: operation.nonce,
        nextAttemptAt: operation.nextAttemptAt ?? null,
        panelId: panel._id,
        previousVersion: previous ? toVersionRecord(previous) : null,
        revokeOwnedRoles: operation.revokeOwnedRoles === true,
        status: operation.status,
        step: operation.step,
        targetVersion: toVersionRecord(target),
        type: operation.type,
        updatedAt: operation.updatedAt,
    };
}

function toVersionRecord(version: StoredReactionRoleVersion) {
    return {
        createdAt: version.createdAt,
        fingerprint: version.fingerprint,
        id: version._id,
        payload: version.payload,
        version: version.version,
    };
}
