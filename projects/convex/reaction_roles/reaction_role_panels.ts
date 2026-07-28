import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import { recordBotActionEventInMutation } from '../core/events.js';
import { requireGuildDocument } from '../posting/posting.js';
import {
    fingerprintReactionRoleVersion,
    normalizeReactionRoleText,
    normalizeReactionRoleVersionPayload,
    type StoredReactionRolePanel,
    type StoredReactionRoleVersion,
    type StoredReactionRoleVersionPayload,
} from './reaction_role_model.js';
import {
    reactionRolePanelMutationResultValidator,
    reactionRolePanelRecordValidator,
    reactionRoleVersionInputValidator,
} from './reaction_role_validators.js';

const allowedServices = ['bot', 'web'] as const;
const maxPanelsPerGuild = 100;
const owningPanelStatuses = ['publishing', 'active', 'updating', 'deactivating', 'degraded', 'unknown'] as const;

type ReactionRoleCtx = QueryCtx | MutationCtx;

export const listReactionRolePanelsByGuild = query({
    args: {
        guildId: v.string(),
    },
    returns: v.array(reactionRolePanelRecordValidator),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, allowedServices);
        const guildId = normalizeReactionRoleText(args.guildId, 'guild-id', 128);
        const panels = await ctx.db
            .query('reactionRolePanels')
            .withIndex('by_guild_updated', (queryBuilder) => queryBuilder.eq('guildId', guildId))
            .order('desc')
            .take(maxPanelsPerGuild);
        return await Promise.all(panels.map((panel) => toPanelRecord(ctx, panel as StoredReactionRolePanel)));
    },
});

export const readReactionRolePanelByMessage = query({
    args: {
        guildId: v.string(),
        messageId: v.string(),
    },
    returns: v.union(reactionRolePanelRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, allowedServices);
        const guildId = normalizeReactionRoleText(args.guildId, 'guild-id', 128);
        const messageId = normalizeReactionRoleText(args.messageId, 'message-id', 128);
        const panel = await ctx.db
            .query('reactionRolePanels')
            .withIndex('by_guild_message', (queryBuilder) =>
                queryBuilder.eq('guildId', guildId).eq('messageId', messageId)
            )
            .unique();
        return panel ? await toPanelRecord(ctx, panel) : null;
    },
});

export const publishReactionRolePanel = mutation({
    args: {
        actorUserId: v.string(),
        channelId: v.string(),
        guildId: v.string(),
        name: v.string(),
        payload: reactionRoleVersionInputValidator,
        requestKey: v.string(),
    },
    returns: reactionRolePanelMutationResultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, allowedServices);
        const guildId = normalizeReactionRoleText(args.guildId, 'guild-id', 128);
        const requestKey = normalizeReactionRoleText(args.requestKey, 'request-key', 128);
        const actorUserId = normalizeReactionRoleText(args.actorUserId, 'actor-user-id', 128);
        const channelId = normalizeReactionRoleText(args.channelId, 'channel-id', 128);
        const name = normalizeReactionRoleText(args.name, 'name', 80);
        const payload = normalizeReactionRoleVersionPayload(args.payload);
        const requestFingerprint = fingerprintRequest({
            actorUserId,
            channelId,
            kind: 'publish',
            name,
            payload: fingerprintReactionRoleVersion(payload),
        });
        const existing = await findOperationByRequestKey(ctx, guildId, requestKey);
        if (existing) {
            assertIdempotentReplay(existing.requestFingerprint, requestFingerprint);
            return await toMutationResult(ctx, existing.panelId, existing._id);
        }
        await requireGuildDocument(ctx, guildId);

        await assertRoleOwnershipAvailable(ctx, guildId, undefined, payload);
        const now = new Date().toISOString();
        const panelId = await ctx.db.insert('reactionRolePanels', {
            channelId,
            createdAt: now,
            createdByUserId: actorUserId,
            generation: 1,
            guildId,
            mode: payload.mode,
            name,
            status: 'publishing',
            updatedAt: now,
        });
        const versionId = await insertVersion(ctx, {
            actorUserId: args.actorUserId,
            guildId,
            panelId,
            payload,
            version: 1,
            now,
        });
        await ctx.db.patch('reactionRolePanels', panelId, { desiredVersionId: versionId });
        const operationId = await ctx.db.insert('reactionRolePanelOperations', {
            actorUserId: args.actorUserId,
            attemptCount: 0,
            createdAt: now,
            generation: 1,
            guildId,
            nonce: requestKey,
            panelId,
            requestFingerprint,
            requestKey,
            status: 'queued',
            step: 'queued',
            targetVersionId: versionId,
            type: 'publish',
            updatedAt: now,
        });
        await recordAdminChange(ctx, {
            action: 'reaction_roles.panel.publish_requested',
            actorUserId: args.actorUserId,
            guildId,
            optionCount: payload.options.length,
            panelId,
        });
        return await toMutationResult(ctx, panelId, operationId);
    },
});

export const updateReactionRolePanel = mutation({
    args: {
        actorUserId: v.string(),
        channelId: v.string(),
        expectedUpdatedAt: v.string(),
        guildId: v.string(),
        name: v.string(),
        panelId: v.string(),
        payload: reactionRoleVersionInputValidator,
        requestKey: v.string(),
    },
    returns: reactionRolePanelMutationResultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, allowedServices);
        const guildId = normalizeReactionRoleText(args.guildId, 'guild-id', 128);
        const requestKey = normalizeReactionRoleText(args.requestKey, 'request-key', 128);
        const actorUserId = normalizeReactionRoleText(args.actorUserId, 'actor-user-id', 128);
        const channelId = normalizeReactionRoleText(args.channelId, 'channel-id', 128);
        const name = normalizeReactionRoleText(args.name, 'name', 80);
        const panelId = normalizeReactionRoleText(args.panelId, 'panel-id', 128);
        const payload = normalizeReactionRoleVersionPayload(args.payload);
        const requestFingerprint = fingerprintRequest({
            actorUserId,
            channelId,
            expectedUpdatedAt: args.expectedUpdatedAt,
            kind: 'update',
            name,
            panelId,
            payload: fingerprintReactionRoleVersion(payload),
        });
        const existing = await findOperationByRequestKey(ctx, guildId, requestKey);
        if (existing) {
            assertIdempotentReplay(existing.requestFingerprint, requestFingerprint);
            return await toMutationResult(ctx, existing.panelId, existing._id);
        }
        const panel = await requirePanel(ctx, panelId, guildId);
        if (panel.updatedAt !== args.expectedUpdatedAt) throw new Error('reaction-role-version-conflict');
        if (panel.status !== 'active' && panel.status !== 'degraded') {
            throw new Error('reaction-role-panel-not-editable');
        }
        if (channelId !== panel.channelId) throw new Error('reaction-role-channel-immutable');
        await assertRoleOwnershipAvailable(ctx, guildId, panel._id, payload);
        const currentVersion = await requireDesiredVersion(ctx, panel);
        const now = new Date().toISOString();
        const versionId = await insertVersion(ctx, {
            actorUserId: args.actorUserId,
            guildId,
            panelId: panel._id,
            payload,
            version: currentVersion.version + 1,
            now,
        });
        const generation = panel.generation + 1;
        const replacesMissingMessage = !panel.messageId;
        await ctx.db.patch('reactionRolePanels', panel._id, {
            ...(replacesMissingMessage ? { messageId: undefined } : {}),
            desiredVersionId: versionId,
            errorCode: undefined,
            generation,
            mode: payload.mode,
            name,
            reconciliationId: undefined,
            status: replacesMissingMessage ? 'publishing' : 'updating',
            updatedAt: now,
        });
        const operationId = await ctx.db.insert('reactionRolePanelOperations', {
            actorUserId: args.actorUserId,
            attemptCount: 0,
            createdAt: now,
            generation,
            guildId,
            nonce: requestKey,
            panelId: panel._id,
            requestFingerprint,
            requestKey,
            status: 'queued',
            step: 'queued',
            targetVersionId: versionId,
            type: replacesMissingMessage ? 'publish' : 'update',
            updatedAt: now,
        });
        await recordAdminChange(ctx, {
            action: 'reaction_roles.panel.update_requested',
            actorUserId: args.actorUserId,
            guildId,
            optionCount: payload.options.length,
            panelId: panel._id,
        });
        return await toMutationResult(ctx, panel._id, operationId);
    },
});

export const deactivateReactionRolePanel = mutation({
    args: {
        actorUserId: v.string(),
        deleteMessage: v.boolean(),
        expectedUpdatedAt: v.string(),
        guildId: v.string(),
        panelId: v.string(),
        requestKey: v.string(),
        revokeOwnedRoles: v.boolean(),
    },
    returns: reactionRolePanelMutationResultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, allowedServices);
        const guildId = normalizeReactionRoleText(args.guildId, 'guild-id', 128);
        const requestKey = normalizeReactionRoleText(args.requestKey, 'request-key', 128);
        const actorUserId = normalizeReactionRoleText(args.actorUserId, 'actor-user-id', 128);
        const panelId = normalizeReactionRoleText(args.panelId, 'panel-id', 128);
        const requestFingerprint = fingerprintRequest({
            actorUserId,
            deleteMessage: args.deleteMessage,
            expectedUpdatedAt: args.expectedUpdatedAt,
            kind: 'deactivate',
            panelId,
            revokeOwnedRoles: args.revokeOwnedRoles,
        });
        const existing = await findOperationByRequestKey(ctx, guildId, requestKey);
        if (existing) {
            assertIdempotentReplay(existing.requestFingerprint, requestFingerprint);
            return await toMutationResult(ctx, existing.panelId, existing._id);
        }
        const panel = await requirePanel(ctx, panelId, guildId);
        if (panel.updatedAt !== args.expectedUpdatedAt) throw new Error('reaction-role-version-conflict');
        if (!panel.desiredVersionId) throw new Error('reaction-role-version-not-found');
        if (panel.status !== 'active' && panel.status !== 'degraded' && panel.status !== 'unknown') {
            throw new Error('reaction-role-panel-not-deactivatable');
        }
        const now = new Date().toISOString();
        const generation = panel.generation + 1;
        await ctx.db.patch('reactionRolePanels', panel._id, {
            errorCode: undefined,
            generation,
            reconciliationId: undefined,
            status: 'deactivating',
            updatedAt: now,
        });
        const operationId = await ctx.db.insert('reactionRolePanelOperations', {
            actorUserId: args.actorUserId,
            attemptCount: 0,
            createdAt: now,
            deleteMessage: args.deleteMessage,
            generation,
            guildId,
            nonce: requestKey,
            panelId: panel._id,
            requestFingerprint,
            requestKey,
            revokeOwnedRoles: args.revokeOwnedRoles,
            status: 'queued',
            step: 'queued',
            targetVersionId: panel.desiredVersionId,
            type: 'deactivate',
            updatedAt: now,
        });
        await recordAdminChange(ctx, {
            action: 'reaction_roles.panel.deactivate_requested',
            actorUserId: args.actorUserId,
            guildId,
            optionCount: 0,
            panelId: panel._id,
        });
        return await toMutationResult(ctx, panel._id, operationId);
    },
});

async function insertVersion(
    ctx: MutationCtx,
    input: {
        actorUserId: string;
        guildId: string;
        now: string;
        panelId: GenericId<'reactionRolePanels'>;
        payload: StoredReactionRoleVersionPayload;
        version: number;
    }
) {
    return await ctx.db.insert('reactionRolePanelVersions', {
        createdAt: input.now,
        createdByUserId: input.actorUserId,
        fingerprint: fingerprintReactionRoleVersion(input.payload),
        guildId: input.guildId,
        panelId: input.panelId,
        payload: input.payload,
        version: input.version,
    });
}

async function assertRoleOwnershipAvailable(
    ctx: ReactionRoleCtx,
    guildId: string,
    currentPanelId: GenericId<'reactionRolePanels'> | undefined,
    payload: StoredReactionRoleVersionPayload
): Promise<void> {
    const panels = (
        await Promise.all(
            owningPanelStatuses.map((status) =>
                ctx.db
                    .query('reactionRolePanels')
                    .withIndex('by_guild_status_updated', (queryBuilder) =>
                        queryBuilder.eq('guildId', guildId).eq('status', status)
                    )
                    .take(maxPanelsPerGuild + 1)
            )
        )
    ).flat() as StoredReactionRolePanel[];
    if (currentPanelId === undefined && panels.length >= maxPanelsPerGuild) {
        throw new Error('reaction-role-panel-capacity-reached');
    }
    if (panels.length > maxPanelsPerGuild) throw new Error('reaction-role-panel-capacity-reached');
    const desiredRoleIds = new Set(payload.options.map((option) => option.roleId));
    for (const candidate of panels) {
        if (candidate._id === currentPanelId || !candidate.desiredVersionId) continue;
        const version = (await ctx.db.get(
            'reactionRolePanelVersions',
            candidate.desiredVersionId
        )) as StoredReactionRoleVersion | null;
        if (version?.payload.options.some((option) => desiredRoleIds.has(option.roleId))) {
            throw new Error('reaction-role-role-already-managed');
        }
    }
}

async function findOperationByRequestKey(ctx: ReactionRoleCtx, guildId: string, requestKey: string) {
    return await ctx.db
        .query('reactionRolePanelOperations')
        .withIndex('by_guild_request', (queryBuilder) =>
            queryBuilder.eq('guildId', guildId).eq('requestKey', requestKey)
        )
        .unique();
}

function fingerprintRequest(value: Record<string, unknown>): string {
    return JSON.stringify(value);
}

function assertIdempotentReplay(existingFingerprint: string, requestedFingerprint: string): void {
    if (existingFingerprint !== requestedFingerprint) throw new Error('reaction-role-request-key-conflict');
}

async function requirePanel(ctx: ReactionRoleCtx, panelId: string, guildId: string): Promise<StoredReactionRolePanel> {
    const panel = (await ctx.db.get(
        'reactionRolePanels',
        panelId as GenericId<'reactionRolePanels'>
    )) as StoredReactionRolePanel | null;
    if (panel?.guildId !== guildId) throw new Error('reaction-role-panel-not-found');
    return panel;
}

async function requireDesiredVersion(
    ctx: ReactionRoleCtx,
    panel: StoredReactionRolePanel
): Promise<StoredReactionRoleVersion> {
    if (!panel.desiredVersionId) throw new Error('reaction-role-version-not-found');
    const version = (await ctx.db.get(
        'reactionRolePanelVersions',
        panel.desiredVersionId
    )) as StoredReactionRoleVersion | null;
    if (version?.panelId !== panel._id) throw new Error('reaction-role-version-not-found');
    return version;
}

async function toPanelRecord(ctx: ReactionRoleCtx, panel: StoredReactionRolePanel) {
    const version = await requireDesiredVersion(ctx, panel);
    return {
        appliedVersionId: panel.appliedVersionId ?? null,
        channelId: panel.channelId,
        createdAt: panel.createdAt,
        desiredVersion: {
            createdAt: version.createdAt,
            fingerprint: version.fingerprint,
            id: version._id,
            payload: version.payload,
            version: version.version,
        },
        errorCode: panel.errorCode ?? null,
        generation: panel.generation,
        guildId: panel.guildId,
        id: panel._id,
        messageId: panel.messageId ?? null,
        mode: panel.mode,
        name: panel.name,
        status: panel.status,
        updatedAt: panel.updatedAt,
    };
}

async function toMutationResult(
    ctx: ReactionRoleCtx,
    panelId: GenericId<'reactionRolePanels'>,
    operationId: GenericId<'reactionRolePanelOperations'>
) {
    const panel = (await ctx.db.get('reactionRolePanels', panelId)) as StoredReactionRolePanel | null;
    const operation = await ctx.db.get('reactionRolePanelOperations', operationId);
    if (!panel || !operation) throw new Error('reaction-role-operation-not-found');
    return {
        operation: {
            attemptCount: operation.attemptCount,
            createdAt: operation.createdAt,
            errorCode: operation.errorCode ?? null,
            id: operation._id,
            messageId: operation.messageId ?? null,
            nextAttemptAt: operation.nextAttemptAt ?? null,
            panelId: operation.panelId,
            status: operation.status,
            step: operation.step,
            type: operation.type,
            updatedAt: operation.updatedAt,
        },
        panel: await toPanelRecord(ctx, panel),
    };
}

async function recordAdminChange(
    ctx: MutationCtx,
    input: {
        action: string;
        actorUserId: string;
        guildId: string;
        optionCount: number;
        panelId: GenericId<'reactionRolePanels'>;
    }
): Promise<void> {
    await recordBotActionEventInMutation(ctx, {
        action: input.action,
        actorUserId: input.actorUserId,
        feature: 'reaction_roles',
        guildId: input.guildId,
        metadata: {
            optionCount: input.optionCount,
            panelId: input.panelId,
        },
        targetId: input.panelId,
    });
}
