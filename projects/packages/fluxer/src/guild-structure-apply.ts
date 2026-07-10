import { Client } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import { createChannelPlatform, createRolePlatform } from './platform-guild-operations.js';
import type { FluxerPlatformError } from './platform-shared.js';

// Fluxer reads URL link channels as 998, while guild.createChannel creates links with type 5.
const LINK_CHANNEL_CREATE_TYPE = 5;
const LINK_CHANNEL_SNAPSHOT_TYPE = 998;
export const DEFAULT_STRUCTURE_APPLY_OPERATION_DELAY_MS = 750;

export type ApplyFluxerBotGuildStructureUpdateInput = {
    botToken: string;
    guildId: string;
    targetType: string;
    targetId: string;
    changes: Array<{ field: string; before?: unknown; after: unknown }>;
};

export type ApplyFluxerBotGuildStructureActionInput = {
    botToken: string;
    guildId: string;
    actionType: string;
    targetType: string;
    targetId?: string;
    changes?: Array<{ field: string; before?: unknown; after: unknown }>;
    after?: unknown;
    idMap?: Record<string, string>;
    sourceGuildId?: string;
};

export type ApplyFluxerBotGuildStructureActionResult = {
    createdId?: string;
};

export type ApplyFluxerBotGuildStructureBatchActionInput = Omit<
    ApplyFluxerBotGuildStructureActionInput,
    'botToken' | 'guildId' | 'idMap' | 'sourceGuildId'
> & {
    id: string;
};

export type ApplyFluxerBotGuildStructureRoleOrderInput = {
    sourceId: string;
    position: number;
    hierarchyRank?: number;
};

export type ApplyFluxerBotGuildStructureBatchInput = {
    botToken: string;
    guildId: string;
    actions: ApplyFluxerBotGuildStructureBatchActionInput[];
    beforeMutation?: () => Promise<boolean>;
    idMap?: Record<string, string>;
    operationDelayMs?: number;
    roleOrder?: ApplyFluxerBotGuildStructureRoleOrderInput[];
    sourceGuildId?: string;
    stopAfterDeleteFailures?: boolean;
};

export type ApplyFluxerBotGuildStructureBatchResult = {
    actions: Array<{
        id: string;
        status: 'applied' | 'failed';
        createdId?: string;
        errorCauseType?: string;
        errorType?: string;
    }>;
    idMap: Record<string, string>;
    roleOrder?: {
        status: 'applied' | 'failed';
        errorType?: string;
    };
};

export type ApplyFluxerBotGuildStructureUpdateError =
    | FluxerPlatformError
    | { type: 'apply-lease-lost' }
    | { type: 'missing-input'; field: 'botToken' | 'guildId' | 'targetId' | 'name' | 'after' }
    | { type: 'invalid-value'; field: string }
    | { type: 'unsupported-action'; reason: string }
    | { type: 'login-failed'; error: unknown };

type PartialCreateError = {
    type: 'partial-create-failed';
    createdId: string;
    causeType: ApplyFluxerBotGuildStructureUpdateError['type'];
};

export type ApplyFluxerBotGuildStructureActionError = ApplyFluxerBotGuildStructureUpdateError | PartialCreateError;
type ApplyNormalizedActionError = ApplyFluxerBotGuildStructureActionError;
type StructureApplyRateLimiter = {
    waitBeforeMutation: () => Promise<boolean>;
};

export async function applyFluxerBotGuildStructureUpdate(
    input: ApplyFluxerBotGuildStructureUpdateInput
): Promise<Result<void, ApplyFluxerBotGuildStructureUpdateError>> {
    const result = await applyFluxerBotGuildStructureAction({
        ...input,
        actionType: 'update',
    });

    if (result.isOk()) return ok(undefined);
    if (result.error.type === 'partial-create-failed') {
        return err({ type: 'operation-failed', error: new Error('Unexpected partial create failure during update.') });
    }

    return err(result.error);
}

export async function applyFluxerBotGuildStructureAction(
    input: ApplyFluxerBotGuildStructureActionInput
): Promise<Result<ApplyFluxerBotGuildStructureActionResult, ApplyFluxerBotGuildStructureActionError>> {
    const normalized = normalizeStructureActionInput(input);

    if (normalized.isErr()) {
        return err(normalized.error);
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(normalized.value.botToken);

        return await applyNormalizedAction(client, normalized.value, createStructureApplyRateLimiter(0));
    } catch (error) {
        return err({ type: 'login-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

export async function applyFluxerBotGuildStructureActions(
    input: ApplyFluxerBotGuildStructureBatchInput
): Promise<Result<ApplyFluxerBotGuildStructureBatchResult, ApplyFluxerBotGuildStructureActionError>> {
    const botToken = input.botToken.trim();
    const guildId = input.guildId.trim();

    if (!botToken) return err({ type: 'missing-input', field: 'botToken' });
    if (!guildId) return err({ type: 'missing-input', field: 'guildId' });

    const client = new Client({ gatewayDebug: false });
    const idMap: Record<string, string> = { ...(input.idMap ?? {}) };
    const actions: ApplyFluxerBotGuildStructureBatchResult['actions'] = [];
    const rateLimiter = createStructureApplyRateLimiter(input.operationDelayMs, input.beforeMutation);

    try {
        await client.login(botToken);

        let deleteFailed = false;
        let leaseLost = false;

        for (const action of input.actions) {
            if (leaseLost) {
                actions.push({ id: action.id, status: 'failed', errorType: 'apply-lease-lost' });
                continue;
            }

            if (input.stopAfterDeleteFailures === true && deleteFailed && action.actionType !== 'delete') {
                actions.push({
                    id: action.id,
                    status: 'failed',
                    errorType: 'reset-delete-failed',
                });
                continue;
            }

            const normalized = normalizeStructureActionInput({
                ...action,
                botToken,
                guildId,
                idMap,
                ...(input.sourceGuildId ? { sourceGuildId: input.sourceGuildId } : {}),
            });

            if (normalized.isErr()) {
                actions.push({ id: action.id, status: 'failed', errorType: normalized.error.type });
                if (action.actionType === 'delete') deleteFailed = true;
                continue;
            }

            const result = await applyNormalizedAction(client, normalized.value, rateLimiter);

            if (result.isErr()) {
                if (result.error.type === 'apply-lease-lost') leaseLost = true;
                if (action.actionType === 'delete') deleteFailed = true;

                if (action.targetId && result.error.type === 'partial-create-failed') {
                    if (result.error.causeType === 'apply-lease-lost') leaseLost = true;
                    idMap[action.targetId] = result.error.createdId;
                    actions.push({
                        id: action.id,
                        status: 'failed',
                        createdId: result.error.createdId,
                        errorType: result.error.type,
                        errorCauseType: result.error.causeType,
                    });
                    continue;
                }

                actions.push({ id: action.id, status: 'failed', errorType: result.error.type });
                continue;
            }

            if (action.targetId && result.value.createdId) {
                idMap[action.targetId] = result.value.createdId;
            }

            actions.push({
                id: action.id,
                status: 'applied',
                ...(result.value.createdId ? { createdId: result.value.createdId } : {}),
            });
        }

        const roleOrder = await applyRequestedRoleOrder(client, {
            guildId,
            idMap,
            rateLimiter,
            ...(input.roleOrder ? { roleOrder: input.roleOrder } : {}),
            shouldApply: actions.every((action) => action.status === 'applied'),
        });

        if (roleOrder) {
            return ok({ actions, idMap, roleOrder });
        }

        return ok({ actions, idMap });
    } catch (error) {
        return err({ type: 'login-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

async function applyRequestedRoleOrder(
    client: Client,
    input: {
        guildId: string;
        idMap: Record<string, string>;
        rateLimiter: StructureApplyRateLimiter;
        roleOrder?: ApplyFluxerBotGuildStructureRoleOrderInput[];
        shouldApply: boolean;
    }
): Promise<ApplyFluxerBotGuildStructureBatchResult['roleOrder'] | undefined> {
    if (!input.shouldApply || !input.roleOrder || input.roleOrder.length === 0) return undefined;

    const positions = normalizeRequestedRolePositions(input.roleOrder, input.idMap);

    if (positions.length === 0) return undefined;

    if (!(await input.rateLimiter.waitBeforeMutation())) return { status: 'failed', errorType: 'apply-lease-lost' };
    const result = await createRolePlatform(client).setPositions({
        guildId: input.guildId,
        positions,
    });

    return result.isOk() ? { status: 'applied' } : { status: 'failed', errorType: result.error.type };
}

function normalizeRequestedRolePositions(
    roleOrder: ApplyFluxerBotGuildStructureRoleOrderInput[],
    idMap: Record<string, string>
): Array<{ roleId: string; position: number }> {
    const seenTargetIds = new Set<string>();

    return [...roleOrder]
        .filter(
            (role): role is ApplyFluxerBotGuildStructureRoleOrderInput =>
                typeof role.sourceId === 'string' &&
                role.sourceId.trim().length > 0 &&
                Number.isInteger(role.position) &&
                role.position > 0
        )
        .sort(compareRequestedRoleOrder)
        .flatMap((role) => {
            const targetId = idMap[role.sourceId.trim()] ?? role.sourceId.trim();

            if (!targetId || seenTargetIds.has(targetId)) return [];
            seenTargetIds.add(targetId);

            return [{ roleId: targetId, position: role.position }];
        });
}

function compareRequestedRoleOrder(
    left: ApplyFluxerBotGuildStructureRoleOrderInput,
    right: ApplyFluxerBotGuildStructureRoleOrderInput
): number {
    if (left.hierarchyRank !== undefined && right.hierarchyRank !== undefined) {
        return left.hierarchyRank - right.hierarchyRank;
    }
    if (left.hierarchyRank !== undefined) return -1;
    if (right.hierarchyRank !== undefined) return 1;

    return right.position - left.position || left.sourceId.localeCompare(right.sourceId);
}

type NormalizedStructureActionInput =
    | {
          botToken: string;
          guildId: string;
          actionType: 'noop';
          createdId: string;
      }
    | {
          botToken: string;
          guildId: string;
          actionType: 'update';
          targetType: 'role';
          targetId: string;
          role: RoleUpdateInput;
      }
    | {
          botToken: string;
          guildId: string;
          actionType: 'update';
          targetType: 'category' | 'channel';
          targetId: string;
          name?: string;
          parentId?: string | null;
          permissionOverwrites?: PermissionOverwriteReplacement;
          position?: number;
      }
    | {
          botToken: string;
          guildId: string;
          actionType: 'delete';
          targetType: 'role' | 'category' | 'channel';
          targetId: string;
      }
    | {
          botToken: string;
          guildId: string;
          actionType: 'create';
          targetType: 'role';
          sourceId: string;
          name: string;
          permissions?: string;
          color?: number;
          hoist?: boolean;
          mentionable?: boolean;
      }
    | {
          botToken: string;
          guildId: string;
          actionType: 'create';
          targetType: 'category' | 'channel';
          sourceId: string;
          name: string;
          channelType: 0 | 2 | 4 | 5;
          url?: string | null;
          parentId?: string | null;
          permissionOverwrites: PermissionOverwrite[];
          position?: number;
      };

type PermissionOverwrite = {
    id: string;
    type: 0 | 1;
    allow: string;
    deny: string;
};

type PermissionOverwriteReplacement = {
    before: PermissionOverwrite[];
    after: PermissionOverwrite[];
};

type RoleUpdateInput = {
    name?: string;
    permissions?: string;
    color?: number;
    hoist?: boolean;
    mentionable?: boolean;
    position?: number;
};

function normalizeStructureActionInput(
    input: ApplyFluxerBotGuildStructureActionInput
): Result<NormalizedStructureActionInput, ApplyFluxerBotGuildStructureActionError> {
    const botToken = input.botToken.trim();
    const guildId = input.guildId.trim();

    if (!botToken) return err({ type: 'missing-input', field: 'botToken' });
    if (!guildId) return err({ type: 'missing-input', field: 'guildId' });

    switch (input.actionType) {
        case 'create':
            return normalizeStructureCreateInput({ ...input, botToken, guildId });
        case 'delete':
            return normalizeStructureDeleteInput({ ...input, botToken, guildId });
        case 'update':
            return normalizeStructureUpdateInput({ ...input, botToken, guildId });
        default:
            return err({
                type: 'unsupported-action',
                reason: 'Only create, update, and delete actions are supported.',
            });
    }
}

async function applyNormalizedAction(
    client: Client,
    input: NormalizedStructureActionInput,
    rateLimiter: StructureApplyRateLimiter
): Promise<Result<ApplyFluxerBotGuildStructureActionResult, ApplyNormalizedActionError>> {
    switch (input.actionType) {
        case 'noop':
            return ok({ createdId: input.createdId });
        case 'create':
            return await applyCreate(client, input, rateLimiter);
        case 'delete':
            return await applyDelete(client, input, rateLimiter);
        case 'update':
            return await applyUpdate(client, input, rateLimiter);
    }
}

function normalizeStructureDeleteInput(
    input: ApplyFluxerBotGuildStructureActionInput & { botToken: string; guildId: string }
): Result<Extract<NormalizedStructureActionInput, { actionType: 'delete' }>, ApplyFluxerBotGuildStructureActionError> {
    const targetId = input.targetId?.trim() ?? '';

    if (!targetId) return err({ type: 'missing-input', field: 'targetId' });
    if (input.targetType !== 'role' && input.targetType !== 'category' && input.targetType !== 'channel') {
        return err({ type: 'unsupported-action', reason: 'Only role, channel, and category deletes are supported.' });
    }
    if (input.targetType === 'role' && targetId === input.guildId) {
        return err({ type: 'unsupported-action', reason: 'Protected default roles cannot be deleted.' });
    }

    return ok({
        botToken: input.botToken,
        guildId: input.guildId,
        actionType: 'delete',
        targetType: input.targetType,
        targetId,
    });
}

function normalizeStructureUpdateInput(
    input: ApplyFluxerBotGuildStructureActionInput & { botToken: string; guildId: string }
): Result<Extract<NormalizedStructureActionInput, { actionType: 'update' }>, ApplyFluxerBotGuildStructureActionError> {
    const targetId = input.targetId?.trim() ?? '';

    if (!targetId) return err({ type: 'missing-input', field: 'targetId' });
    if (input.targetType !== 'role' && input.targetType !== 'category' && input.targetType !== 'channel') {
        return err({ type: 'unsupported-action', reason: 'Only role, channel, and category updates are supported.' });
    }
    if (input.targetType === 'role' && targetId === input.guildId) {
        return err({ type: 'unsupported-action', reason: 'Protected default roles cannot be updated.' });
    }

    if (input.targetType === 'role') {
        return normalizeStructureRoleUpdateInput(input, targetId);
    }

    const changes = input.changes ?? [];
    const nameChanges = changes.filter((change) => change.field === 'name');
    const parentChanges = changes.filter((change) => change.field === 'parentId');
    const permissionOverwriteChanges = changes.filter((change) => change.field === 'permissionOverwrites');
    const positionChanges = changes.filter((change) => change.field === 'position');

    if (
        nameChanges.length + parentChanges.length + permissionOverwriteChanges.length + positionChanges.length !==
        changes.length
    ) {
        return err({
            type: 'unsupported-action',
            reason: 'Only channel/category name, parent, position, and permission overwrite updates are supported.',
        });
    }

    if (
        nameChanges.length > 1 ||
        parentChanges.length > 1 ||
        permissionOverwriteChanges.length > 1 ||
        positionChanges.length > 1
    ) {
        return err({ type: 'invalid-value', field: 'changes' });
    }

    const name = typeof nameChanges[0]?.after === 'string' ? nameChanges[0].after.trim() : undefined;
    const parentIdResult = normalizeChannelParentUpdate(input.targetType, parentChanges[0], input.idMap ?? {});
    const positionResult = normalizeChannelPositionUpdate(positionChanges[0]);

    if (nameChanges.length === 1 && !name) return err({ type: 'missing-input', field: 'name' });
    if (parentIdResult.isErr()) return err(parentIdResult.error);
    if (positionResult.isErr()) return err(positionResult.error);

    const permissionOverwriteReplacement = normalizePermissionOverwriteReplacement(
        permissionOverwriteChanges[0],
        createPermissionOverwriteMapping(input.guildId, input.idMap ?? {}, input.sourceGuildId)
    );

    if (permissionOverwriteChanges.length === 1 && !permissionOverwriteReplacement) {
        return err({ type: 'invalid-value', field: 'permissionOverwrites' });
    }

    if (
        !name &&
        parentIdResult.value === undefined &&
        !permissionOverwriteReplacement &&
        positionResult.value === undefined
    ) {
        return err({
            type: 'unsupported-action',
            reason: 'Only channel/category name, parent, position, and permission overwrite updates are supported.',
        });
    }

    return ok({
        botToken: input.botToken,
        guildId: input.guildId,
        actionType: 'update',
        targetType: input.targetType,
        targetId,
        ...(name ? { name } : {}),
        ...(parentIdResult.value !== undefined ? { parentId: parentIdResult.value } : {}),
        ...(permissionOverwriteReplacement ? { permissionOverwrites: permissionOverwriteReplacement } : {}),
        ...(positionResult.value !== undefined ? { position: positionResult.value } : {}),
    });
}

function normalizeStructureRoleUpdateInput(
    input: ApplyFluxerBotGuildStructureActionInput & { botToken: string; guildId: string },
    targetId: string
): Result<
    Extract<NormalizedStructureActionInput, { actionType: 'update'; targetType: 'role' }>,
    ApplyFluxerBotGuildStructureActionError
> {
    const changes = input.changes ?? [];
    const role: RoleUpdateInput = {};
    const seenFields = new Set<string>();
    const supportedFields = new Set(['name', 'position', 'permissions', 'color', 'hoist', 'mentionable']);

    for (const change of changes) {
        if (!supportedFields.has(change.field)) {
            return err({
                type: 'unsupported-action',
                reason: 'Only role name, position, permissions, color, hoist, and mentionable updates are supported.',
            });
        }

        if (seenFields.has(change.field)) return err({ type: 'invalid-value', field: 'changes' });
        seenFields.add(change.field);

        switch (change.field) {
            case 'name':
                if (typeof change.after !== 'string' || !change.after.trim()) {
                    return err({ type: 'missing-input', field: 'name' });
                }
                role.name = change.after.trim();
                break;
            case 'permissions':
                if (typeof change.after !== 'string' || !change.after.trim()) {
                    return err({ type: 'missing-input', field: 'permissions' });
                }
                role.permissions = change.after.trim();
                break;
            case 'position':
                if (targetId === input.guildId) return err({ type: 'invalid-value', field: 'position' });
                if (!isValidPosition(change.after)) return err({ type: 'invalid-value', field: 'position' });
                role.position = change.after;
                break;
            case 'color':
                if (
                    typeof change.after !== 'number' ||
                    !Number.isInteger(change.after) ||
                    change.after < 0 ||
                    change.after > 0xffffff
                ) {
                    return err({ type: 'invalid-value', field: 'color' });
                }
                role.color = change.after;
                break;
            case 'hoist':
            case 'mentionable':
                if (typeof change.after !== 'boolean') return err({ type: 'invalid-value', field: change.field });
                role[change.field] = change.after;
                break;
        }
    }

    if (Object.keys(role).length === 0) {
        return err({
            type: 'unsupported-action',
            reason: 'Only role name, position, permissions, color, hoist, and mentionable updates are supported.',
        });
    }

    return ok({
        botToken: input.botToken,
        guildId: input.guildId,
        actionType: 'update',
        targetType: 'role',
        targetId,
        role,
    });
}

function normalizeStructureCreateInput(
    input: ApplyFluxerBotGuildStructureActionInput & { botToken: string; guildId: string }
): Result<
    Extract<NormalizedStructureActionInput, { actionType: 'create' | 'noop' | 'update' }>,
    ApplyFluxerBotGuildStructureActionError
> {
    const after = input.after;
    const sourceId = input.targetId?.trim() ?? '';

    if (!sourceId) return err({ type: 'missing-input', field: 'targetId' });
    if (!isObject(after)) return err({ type: 'missing-input', field: 'after' });
    if (typeof after.name !== 'string' || !after.name.trim()) return err({ type: 'missing-input', field: 'name' });

    const name = after.name.trim();
    const mappedCreatedId = input.idMap?.[sourceId];

    if (input.targetType === 'role') {
        if (isProtectedRolePayload(after) || isDefaultRolePayload(after) || sourceId === input.guildId) {
            return err({
                type: 'unsupported-action',
                reason: 'Protected bot, integration, and default roles cannot be created.',
            });
        }

        if (typeof after.permissions !== 'string') return err({ type: 'invalid-value', field: 'permissions' });
        const roleVisuals = normalizeRoleVisuals(after);

        if (!roleVisuals) return err({ type: 'invalid-value', field: 'role' });
        if (
            after.position !== undefined &&
            after.position !== null &&
            normalizeRolePosition(after.position) === undefined
        ) {
            return err({ type: 'invalid-value', field: 'position' });
        }

        if (mappedCreatedId) {
            return ok({
                botToken: input.botToken,
                guildId: input.guildId,
                actionType: 'noop',
                createdId: mappedCreatedId,
            });
        }

        return ok({
            botToken: input.botToken,
            guildId: input.guildId,
            actionType: 'create',
            targetType: 'role',
            sourceId,
            name,
            permissions: after.permissions,
            ...roleVisuals,
        });
    }

    if (input.targetType !== 'category' && input.targetType !== 'channel') {
        return err({ type: 'unsupported-action', reason: 'Only role, channel, and category creates are supported.' });
    }

    const channelType = normalizeChannelType(after.type);

    if (channelType === undefined) return err({ type: 'invalid-value', field: 'type' });
    if (input.targetType === 'category' && channelType !== 4) return err({ type: 'invalid-value', field: 'type' });
    if (input.targetType === 'channel' && channelType === 4) return err({ type: 'invalid-value', field: 'type' });

    const permissionOverwrites = normalizePermissionOverwrites(
        after.permissionOverwrites,
        createPermissionOverwriteMapping(input.guildId, input.idMap ?? {}, input.sourceGuildId)
    );

    if (!permissionOverwrites) return err({ type: 'invalid-value', field: 'permissionOverwrites' });

    const position = normalizeChannelPosition(after.position);
    if (after.position !== undefined && after.position !== null && position === undefined) {
        return err({ type: 'invalid-value', field: 'position' });
    }
    const url = normalizeChannelUrl(after.url);
    if (after.url !== undefined && after.url !== null && url === undefined) {
        return err({ type: 'invalid-value', field: 'url' });
    }

    if (mappedCreatedId) {
        if (permissionOverwrites.length === 0) {
            return ok({
                botToken: input.botToken,
                guildId: input.guildId,
                actionType: 'noop',
                createdId: mappedCreatedId,
            });
        }

        return ok({
            botToken: input.botToken,
            guildId: input.guildId,
            actionType: 'update',
            targetType: input.targetType,
            targetId: mappedCreatedId,
            permissionOverwrites: {
                before: [],
                after: permissionOverwrites,
            },
        });
    }

    return ok({
        botToken: input.botToken,
        guildId: input.guildId,
        actionType: 'create',
        targetType: input.targetType,
        sourceId,
        name,
        channelType,
        ...(url !== undefined ? { url } : {}),
        parentId: mapOptionalId(typeof after.parentId === 'string' ? after.parentId : null, input.idMap ?? {}),
        permissionOverwrites,
        ...(position !== undefined ? { position } : {}),
    });
}

function isProtectedRolePayload(value: unknown): boolean {
    return isObject(value) && (value.protected === true || isRoleProtectionReason(value.protectionReason));
}

function isDefaultRolePayload(value: unknown): boolean {
    return isObject(value) && value.name === '@everyone' && value.position === 0;
}

function isRoleProtectionReason(value: unknown): boolean {
    return value === 'everyone' || value === 'bot' || value === 'integration' || value === 'managed';
}

async function applyUpdate(
    client: Client,
    input: Extract<NormalizedStructureActionInput, { actionType: 'update' }>,
    rateLimiter: StructureApplyRateLimiter
): Promise<Result<ApplyFluxerBotGuildStructureActionResult, ApplyFluxerBotGuildStructureActionError>> {
    if (input.targetType === 'role') {
        if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
        const result = await createRolePlatform(client).edit({
            guildId: input.guildId,
            roleId: input.targetId,
            ...input.role,
        });

        return result.isOk() ? ok({}) : err(result.error);
    }

    const channelPlatform = createChannelPlatform(client);

    if (input.name || input.parentId !== undefined || input.position !== undefined) {
        if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
        const editResult = await channelPlatform.edit({
            channelId: input.targetId,
            guildId: input.guildId,
            ...(input.name ? { name: input.name } : {}),
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.position !== undefined ? { position: input.position } : {}),
        });

        if (editResult.isErr()) return err(editResult.error);
    }

    if (input.permissionOverwrites) {
        const overwriteResult = await applyPermissionOverwrites(
            channelPlatform,
            input.targetId,
            input.permissionOverwrites,
            rateLimiter
        );

        if (overwriteResult.isErr()) return err(overwriteResult.error);
    }

    return ok({});
}

async function applyCreate(
    client: Client,
    input: Extract<NormalizedStructureActionInput, { actionType: 'create' }>,
    rateLimiter: StructureApplyRateLimiter
): Promise<Result<ApplyFluxerBotGuildStructureActionResult, ApplyFluxerBotGuildStructureActionError>> {
    if (input.targetType === 'role') {
        if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
        const result = await createRolePlatform(client).create({
            guildId: input.guildId,
            name: input.name,
            ...(input.permissions ? { permissions: input.permissions } : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.hoist !== undefined ? { hoist: input.hoist } : {}),
            ...(input.mentionable !== undefined ? { mentionable: input.mentionable } : {}),
        });

        return result.isOk() ? ok({ createdId: result.value.id }) : err(result.error);
    }

    const channelPlatform = createChannelPlatform(client);
    if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
    const result = await channelPlatform.create({
        guildId: input.guildId,
        name: input.name,
        type: input.channelType,
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
    });

    if (result.isErr()) return err(result.error);

    if (input.permissionOverwrites.length > 0) {
        const overwriteResult = await applyPermissionOverwrites(
            channelPlatform,
            result.value.id,
            {
                before: [],
                after: input.permissionOverwrites,
            },
            rateLimiter
        );

        if (overwriteResult.isErr()) {
            return err({
                type: 'partial-create-failed',
                createdId: result.value.id,
                causeType: overwriteResult.error.type,
            });
        }
    }

    return ok({ createdId: result.value.id });
}

async function applyDelete(
    client: Client,
    input: Extract<NormalizedStructureActionInput, { actionType: 'delete' }>,
    rateLimiter: StructureApplyRateLimiter
): Promise<Result<ApplyFluxerBotGuildStructureActionResult, ApplyFluxerBotGuildStructureActionError>> {
    if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
    const result =
        input.targetType === 'role'
            ? await createRolePlatform(client).delete({
                  guildId: input.guildId,
                  roleId: input.targetId,
              })
            : await createChannelPlatform(client).delete({
                  channelId: input.targetId,
              });

    return result.isOk() ? ok({}) : err(result.error);
}

function normalizeChannelType(value: unknown): 0 | 2 | 4 | 5 | undefined {
    if (value === LINK_CHANNEL_SNAPSHOT_TYPE) return LINK_CHANNEL_CREATE_TYPE;

    return value === 0 || value === 2 || value === 4 || value === LINK_CHANNEL_CREATE_TYPE ? value : undefined;
}

function normalizeChannelUrl(value: unknown): string | null | undefined {
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;

    const trimmed = value.trim();

    return trimmed ? trimmed : undefined;
}

function normalizeRolePosition(value: unknown): number | undefined {
    return isValidPosition(value) ? value : undefined;
}

function normalizeChannelPosition(value: unknown): number | undefined {
    return isValidPosition(value) ? value : undefined;
}

function isValidPosition(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function normalizeChannelPositionUpdate(
    change: { field: string; before?: unknown; after: unknown } | undefined
): Result<number | undefined, ApplyFluxerBotGuildStructureActionError> {
    if (!change) return ok(undefined);

    const position = normalizeChannelPosition(change.after);
    return position === undefined ? err({ type: 'invalid-value', field: 'position' }) : ok(position);
}

function normalizeChannelParentUpdate(
    targetType: string,
    change: { field: string; before?: unknown; after: unknown } | undefined,
    idMap: Record<string, string>
): Result<string | null | undefined, ApplyFluxerBotGuildStructureActionError> {
    if (!change) return ok(undefined);
    if (targetType === 'category') {
        return err({ type: 'invalid-value', field: 'parentId' });
    }

    if (change.after === null || change.after === undefined) return ok(null);
    if (typeof change.after !== 'string') return err({ type: 'invalid-value', field: 'parentId' });

    return ok(mapOptionalId(change.after, idMap));
}

function normalizeRoleVisuals(
    value: Record<string, unknown>
): Pick<RoleUpdateInput, 'color' | 'hoist' | 'mentionable'> | undefined {
    if (
        typeof value.color !== 'number' ||
        !Number.isInteger(value.color) ||
        value.color < 0 ||
        value.color > 0xffffff ||
        typeof value.hoist !== 'boolean' ||
        typeof value.mentionable !== 'boolean'
    ) {
        return undefined;
    }

    return {
        color: value.color,
        hoist: value.hoist,
        mentionable: value.mentionable,
    };
}

function createPermissionOverwriteMapping(
    guildId: string,
    idMap: Record<string, string>,
    sourceGuildId?: string
): { guildId: string; sourceGuildId?: string; idMap: Record<string, string> } {
    return {
        guildId,
        idMap,
        ...(sourceGuildId ? { sourceGuildId } : {}),
    };
}

function normalizePermissionOverwriteReplacement(
    change: { field: string; before?: unknown; after: unknown } | undefined,
    mapping: { guildId: string; sourceGuildId?: string; idMap: Record<string, string> }
): PermissionOverwriteReplacement | undefined {
    if (!change) return undefined;

    const before = normalizePermissionOverwrites(change.before, createPermissionOverwriteMapping(mapping.guildId, {}));
    const after = normalizePermissionOverwrites(change.after, mapping);

    if (!before || !after) return undefined;

    return { before, after };
}

function normalizePermissionOverwrites(
    value: unknown,
    mapping: { guildId: string; sourceGuildId?: string; idMap: Record<string, string> }
): PermissionOverwrite[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const overwrites: PermissionOverwrite[] = [];

    for (const overwrite of value) {
        if (
            !isObject(overwrite) ||
            typeof overwrite.id !== 'string' ||
            !overwrite.id.trim() ||
            (overwrite.type !== 0 && overwrite.type !== 1) ||
            typeof overwrite.allow !== 'string' ||
            typeof overwrite.deny !== 'string'
        ) {
            return undefined;
        }

        overwrites.push({
            id: mapPermissionOverwriteId(overwrite.id.trim(), overwrite.type, mapping),
            type: overwrite.type,
            allow: overwrite.allow,
            deny: overwrite.deny,
        });
    }

    return overwrites;
}

async function applyPermissionOverwrites(
    channelPlatform: ReturnType<typeof createChannelPlatform>,
    channelId: string,
    replacement: PermissionOverwriteReplacement,
    rateLimiter: StructureApplyRateLimiter
): Promise<Result<void, FluxerPlatformError | { type: 'apply-lease-lost' }>> {
    const beforeByKey = new Map(replacement.before.map((overwrite) => [permissionOverwriteKey(overwrite), overwrite]));
    const afterByKey = new Map(replacement.after.map((overwrite) => [permissionOverwriteKey(overwrite), overwrite]));

    for (const before of replacement.before) {
        if (afterByKey.has(permissionOverwriteKey(before))) continue;

        if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
        const deleteResult = await channelPlatform.deletePermission({
            channelId,
            overwriteId: before.id,
        });

        if (deleteResult.isErr()) return err(deleteResult.error);
    }

    for (const after of replacement.after) {
        const before = beforeByKey.get(permissionOverwriteKey(after));

        if (before && stablePermissionOverwriteKey(before) === stablePermissionOverwriteKey(after)) continue;

        if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
        const editResult = await channelPlatform.editPermission({
            channelId,
            overwriteId: after.id,
            type: after.type,
            allow: after.allow,
            deny: after.deny,
        });

        if (editResult.isErr()) return err(editResult.error);
    }

    return ok(undefined);
}

function mapPermissionOverwriteId(
    id: string,
    type: 0 | 1,
    mapping: { guildId: string; sourceGuildId?: string; idMap: Record<string, string> }
): string {
    if (type === 1) return id;
    if (mapping.sourceGuildId && id === mapping.sourceGuildId) return mapping.guildId;

    return mapping.idMap[id] ?? id;
}

function permissionOverwriteKey(overwrite: PermissionOverwrite): string {
    return `${String(overwrite.type)}:${overwrite.id}`;
}

function stablePermissionOverwriteKey(overwrite: PermissionOverwrite): string {
    return `${String(overwrite.type)}:${overwrite.id}:${overwrite.allow}:${overwrite.deny}`;
}

function mapOptionalId(value: string | null, idMap: Record<string, string>): string | null {
    if (!value) return null;

    return idMap[value] ?? value;
}

function createStructureApplyRateLimiter(
    delayMs = DEFAULT_STRUCTURE_APPLY_OPERATION_DELAY_MS,
    beforeMutation?: () => Promise<boolean>
): StructureApplyRateLimiter {
    const normalizedDelayMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
    let mutationStarted = false;

    return {
        waitBeforeMutation: async () => {
            if (mutationStarted && normalizedDelayMs > 0) {
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, normalizedDelayMs);
                });
            }
            mutationStarted = true;
            return beforeMutation ? beforeMutation() : true;
        },
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
