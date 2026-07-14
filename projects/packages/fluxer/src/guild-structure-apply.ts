import type { Client } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import { createChannelPlatform, createRolePlatform } from './platform-guild-operations.js';
import type { FluxerPlatformError } from './platform-shared.js';
import { createFluxerGuildStructureRestClient } from './guild-structure-rest-client.js';
import {
    createBlueprintReferenceMapping,
    normalizeRequestedChannelPositions,
    normalizeRequestedRolePositions,
    resolveBlueprintReference,
    simulateBlueprintActionAuthority,
    type BlueprintChannelOrderEntry,
    type BlueprintRoleOrderEntry,
    type BlueprintActionAuthoritySnapshot,
    type BlueprintActionReferenceValidationFailure,
    type BlueprintReferenceMapping,
    type BlueprintTargetKind,
} from '@neonflux/blueprint/action-authority';

export type { BlueprintChannelOrderEntry, BlueprintRoleOrderEntry } from '@neonflux/blueprint/action-authority';

const LINK_CHANNEL_TYPE = 998;
export const DEFAULT_STRUCTURE_APPLY_OPERATION_DELAY_MS = 750;

export type ApplyFluxerBotGuildStructureUpdateInput = {
    botToken: string;
    guildId: string;
    knownTargetIds?: readonly string[];
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
    knownTargetIds?: readonly string[];
    knownTargetKinds?: Readonly<Record<string, BlueprintTargetKind>>;
    sourceGuildId?: string;
};

export type ApplyFluxerBotGuildStructureActionResult = {
    createdId?: string;
};

export type ApplyFluxerBotGuildStructureBatchActionInput = Omit<
    ApplyFluxerBotGuildStructureActionInput,
    'botToken' | 'guildId' | 'idMap' | 'knownTargetIds' | 'knownTargetKinds' | 'sourceGuildId'
> & {
    id: string;
};

export type ApplyFluxerBotGuildStructureBatchInput = {
    botToken: string;
    guildId: string;
    actions: ApplyFluxerBotGuildStructureBatchActionInput[];
    beforeMutation?: () => Promise<boolean>;
    beforeAction?: (action: ApplyFluxerBotGuildStructureBatchActionInput) => Promise<boolean>;
    idMap?: Record<string, string>;
    knownTargetKinds: Readonly<Record<string, BlueprintTargetKind>>;
    operationDelayMs?: number;
    referenceIdMap?: Record<string, string>;
    onActionResult?: (
        result: ApplyFluxerBotGuildStructureBatchResult['actions'][number],
        idMap: Readonly<Record<string, string>>
    ) => Promise<boolean>;
    sourceGuildId?: string;
};

export type ApplyFluxerBotGuildStructureBatchResult = {
    actions: Array<{
        id: string;
        status: 'applied' | 'failed';
        createdId?: string;
        errorType?: string;
        mutationOutcome?: 'not-applied' | 'unknown';
        retryAfterMs?: number;
    }>;
    idMap: Record<string, string>;
};

export type ApplyFluxerBotGuildStructureUpdateError =
    | FluxerPlatformError
    | { type: 'apply-lease-lost' }
    | { type: 'missing-input'; field: 'botToken' | 'guildId' | 'targetId' | 'name' | 'after' }
    | { type: 'invalid-value'; field: string; actionId?: string }
    | { type: 'structure-order-mapping-missing' | 'structure-order-plan-invalid'; actionId?: string }
    | { type: 'structure-reference-kind-mismatch'; field: 'parentId' | 'targetId'; actionId?: string }
    | {
          type: 'structure-reference-mapping-missing';
          field: 'parentId' | 'permissionOverwrites' | 'targetId';
          actionId?: string;
      }
    | { type: 'unsupported-action'; reason: string }
    | { type: 'login-failed'; error: unknown };

export type ApplyFluxerBotGuildStructureActionError = ApplyFluxerBotGuildStructureUpdateError;
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
    return err(result.error);
}

export async function applyFluxerBotGuildStructureAction(
    input: ApplyFluxerBotGuildStructureActionInput
): Promise<Result<ApplyFluxerBotGuildStructureActionResult, ApplyFluxerBotGuildStructureActionError>> {
    const normalized = normalizeStructureActionInput(input);

    if (normalized.isErr()) {
        return err(normalized.error);
    }

    const client = createFluxerGuildStructureRestClient(normalized.value.botToken);

    try {
        return await applyNormalizedAction(client, normalized.value, createStructureApplyRateLimiter(0));
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

    const authorityProgression = simulateBlueprintActionAuthority<ApplyNormalizedActionError>({
        actions: input.actions,
        guildId,
        ...((input.referenceIdMap ?? input.idMap) ? { idMap: input.referenceIdMap ?? input.idMap } : {}),
        knownTargetKinds: input.knownTargetKinds,
        ...(input.sourceGuildId ? { sourceGuildId: input.sourceGuildId } : {}),
        visitAction: (action, authority) => {
            const normalized = normalizeStructureActionInput({
                ...action,
                botToken,
                guildId,
                idMap: authority.idMap,
                knownTargetIds: Object.keys(authority.knownTargetKinds),
                knownTargetKinds: authority.knownTargetKinds,
                ...(input.sourceGuildId ? { sourceGuildId: input.sourceGuildId } : {}),
            });
            return normalized.isErr() ? normalized.error : undefined;
        },
    });
    if (!authorityProgression.ok) {
        if (authorityProgression.failure.type === 'visitor') {
            return err({ ...authorityProgression.failure.error, actionId: authorityProgression.actionId });
        }
        return err(
            toApplyReferenceValidationError({
                ok: false,
                actionId: authorityProgression.actionId,
                ...authorityProgression.failure.error,
            })
        );
    }

    const client = createFluxerGuildStructureRestClient(botToken);
    const idMap: Record<string, string> = { ...(input.idMap ?? {}) };
    const actions: ApplyFluxerBotGuildStructureBatchResult['actions'] = [];
    const rateLimiter = createStructureApplyRateLimiter(input.operationDelayMs, input.beforeMutation);

    try {
        for (const [actionIndex, action] of input.actions.entries()) {
            if (input.beforeAction && !(await input.beforeAction(action))) {
                const failedResult = {
                    id: action.id,
                    status: 'failed' as const,
                    errorType: 'apply-lease-lost',
                    mutationOutcome: 'not-applied' as const,
                };
                actions.push(failedResult);
                await input.onActionResult?.(failedResult, idMap);
                break;
            }

            const symbolicAuthority = authorityProgression.steps[actionIndex];
            if (!symbolicAuthority) {
                return err({ type: 'invalid-value', field: `${action.id}.authority`, actionId: action.id });
            }
            const authority = materializeStructureActionAuthority(symbolicAuthority, idMap);
            const normalized = normalizeStructureActionInput({
                ...action,
                botToken,
                guildId,
                idMap: authority.idMap,
                knownTargetIds: Object.keys(authority.knownTargetKinds),
                knownTargetKinds: authority.knownTargetKinds,
                ...(input.sourceGuildId ? { sourceGuildId: input.sourceGuildId } : {}),
            });

            if (normalized.isErr()) {
                const failedResult = {
                    id: action.id,
                    status: 'failed' as const,
                    errorType: normalized.error.type,
                    mutationOutcome: 'not-applied' as const,
                };
                actions.push(failedResult);
                await input.onActionResult?.(failedResult, idMap);
                break;
            }

            const result = await applyNormalizedAction(client, normalized.value, rateLimiter);

            if (result.isErr()) {
                const retryAfterMs = readApplyRetryAfterMs(result.error);
                const failedResult = {
                    id: action.id,
                    status: 'failed' as const,
                    errorType: isRateLimitedApplyError(result.error) ? 'rate-limited' : result.error.type,
                    mutationOutcome: classifyApplyMutationFailure(result.error),
                    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
                };
                actions.push(failedResult);
                await input.onActionResult?.(failedResult, idMap);
                break;
            }

            if (action.targetId && result.value.createdId) {
                idMap[action.targetId] = result.value.createdId;
            }

            const appliedResult = {
                id: action.id,
                status: 'applied' as const,
                ...(result.value.createdId ? { createdId: result.value.createdId } : {}),
            };
            actions.push(appliedResult);
            if (input.onActionResult && !(await input.onActionResult(appliedResult, idMap))) break;
        }

        return ok({ actions, idMap });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

type NormalizedStructureActionInput =
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
          actionType: 'update';
          targetType: 'channel-order';
          positions: Array<{ channelId: string; parentId: string | null; position: number }>;
      }
    | {
          botToken: string;
          guildId: string;
          actionType: 'update';
          targetType: 'role-order';
          positions: Array<{ roleId: string; position: number }>;
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
          channelType: 0 | 2 | 4 | 998;
          url?: string | null;
          parentId?: string | null;
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
    const targetIdInput = input.targetId?.trim() ?? '';

    if (!targetIdInput) return err({ type: 'missing-input', field: 'targetId' });
    if (input.targetType !== 'role' && input.targetType !== 'category' && input.targetType !== 'channel') {
        return err({ type: 'unsupported-action', reason: 'Only role, channel, and category deletes are supported.' });
    }
    const targetId = resolveBlueprintReference(targetIdInput, createBlueprintReferenceMapping(input));
    if (!targetId) return err({ type: 'structure-reference-mapping-missing', field: 'targetId' });
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
    const referenceMapping = createBlueprintReferenceMapping(input);
    if (input.targetType === 'channel-order') {
        if (!Array.isArray(input.after) || input.after.length === 0)
            return err({ type: 'structure-order-plan-invalid' });
        const normalized = normalizeRequestedChannelPositions(
            input.after as BlueprintChannelOrderEntry[],
            referenceMapping
        );
        return normalized.ok
            ? ok({
                  botToken: input.botToken,
                  guildId: input.guildId,
                  actionType: 'update',
                  targetType: 'channel-order',
                  positions: normalized.positions,
              })
            : err({ type: normalized.errorType });
    }
    if (input.targetType === 'role-order') {
        if (!Array.isArray(input.after) || input.after.length === 0)
            return err({ type: 'structure-order-plan-invalid' });
        const normalized = normalizeRequestedRolePositions(input.after as BlueprintRoleOrderEntry[], referenceMapping);
        return normalized.ok
            ? ok({
                  botToken: input.botToken,
                  guildId: input.guildId,
                  actionType: 'update',
                  targetType: 'role-order',
                  positions: normalized.positions,
              })
            : err({ type: normalized.errorType });
    }

    const targetIdInput = input.targetId?.trim() ?? '';

    if (!targetIdInput) return err({ type: 'missing-input', field: 'targetId' });
    if (input.targetType !== 'role' && input.targetType !== 'category' && input.targetType !== 'channel') {
        return err({ type: 'unsupported-action', reason: 'Only role, channel, and category updates are supported.' });
    }
    const targetId = resolveBlueprintReference(targetIdInput, referenceMapping);
    if (!targetId) return err({ type: 'structure-reference-mapping-missing', field: 'targetId' });
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
    const parentIdResult = normalizeChannelParentUpdate(input.targetType, parentChanges[0], referenceMapping);
    const positionResult = normalizeChannelPositionUpdate(positionChanges[0]);

    if (nameChanges.length === 1 && !name) return err({ type: 'missing-input', field: 'name' });
    if (parentIdResult.isErr()) return err(parentIdResult.error);
    if (positionResult.isErr()) return err(positionResult.error);

    const permissionOverwriteReplacement = normalizePermissionOverwriteReplacement(
        permissionOverwriteChanges[0],
        referenceMapping
    );
    if (permissionOverwriteReplacement.isErr()) return err(permissionOverwriteReplacement.error);

    const providerMutationCount =
        (name ? 1 : 0) +
        (parentIdResult.value !== undefined || positionResult.value !== undefined ? 1 : 0) +
        (permissionOverwriteReplacement.value
            ? countPermissionOverwriteMutations(permissionOverwriteReplacement.value)
            : 0);
    if (providerMutationCount !== 1) return err({ type: 'invalid-value', field: 'changes' });

    if (
        !name &&
        parentIdResult.value === undefined &&
        !permissionOverwriteReplacement.value &&
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
        ...(permissionOverwriteReplacement.value ? { permissionOverwrites: permissionOverwriteReplacement.value } : {}),
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

    const roleMutationCount =
        (role.position !== undefined ? 1 : 0) + (Object.keys(role).some((field) => field !== 'position') ? 1 : 0);
    if (roleMutationCount !== 1) {
        return err({
            type: 'invalid-value',
            field: 'changes',
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
): Result<Extract<NormalizedStructureActionInput, { actionType: 'create' }>, ApplyFluxerBotGuildStructureActionError> {
    const after = input.after;
    const sourceId = input.targetId?.trim() ?? '';
    const referenceMapping = createBlueprintReferenceMapping(input);

    if (!sourceId) return err({ type: 'missing-input', field: 'targetId' });
    if (!isObject(after)) return err({ type: 'missing-input', field: 'after' });
    if (typeof after.name !== 'string' || !after.name.trim()) return err({ type: 'missing-input', field: 'name' });

    const name = after.name.trim();
    const mappedCreatedId = input.idMap?.[sourceId];
    if (mappedCreatedId) return err({ type: 'invalid-value', field: 'targetId' });

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

    const permissionOverwrites = normalizePermissionOverwrites(after.permissionOverwrites, referenceMapping);
    if (permissionOverwrites.isErr()) return err(permissionOverwrites.error);
    if (permissionOverwrites.value.length > 0) return err({ type: 'invalid-value', field: 'permissionOverwrites' });

    const position = normalizeChannelPosition(after.position);
    if (after.position !== undefined && after.position !== null && position === undefined) {
        return err({ type: 'invalid-value', field: 'position' });
    }
    const url = normalizeChannelUrl(after.url);
    if (after.url !== undefined && after.url !== null && url === undefined) {
        return err({ type: 'invalid-value', field: 'url' });
    }

    const parentId = normalizeOptionalStructureReference(
        typeof after.parentId === 'string' ? after.parentId : null,
        referenceMapping,
        'parentId'
    );
    if (parentId.isErr()) return err(parentId.error);

    return ok({
        botToken: input.botToken,
        guildId: input.guildId,
        actionType: 'create',
        targetType: input.targetType,
        sourceId,
        name,
        channelType,
        ...(url !== undefined ? { url } : {}),
        parentId: parentId.value,
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
    if (input.targetType === 'channel-order') {
        if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
        const result = await createChannelPlatform(client).setPositions({
            guildId: input.guildId,
            positions: input.positions,
        });
        return result.isOk() ? ok({}) : err(result.error);
    }
    if (input.targetType === 'role-order') {
        if (!(await rateLimiter.waitBeforeMutation())) return err({ type: 'apply-lease-lost' });
        const result = await createRolePlatform(client).setPositions({
            guildId: input.guildId,
            positions: input.positions,
        });
        return result.isOk() ? ok({}) : err(result.error);
    }
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

    if (result.isOk() || result.error.type === 'not-found') return ok({});
    return err(result.error);
}

function normalizeChannelType(value: unknown): 0 | 2 | 4 | 998 | undefined {
    return value === 0 || value === 2 || value === 4 || value === LINK_CHANNEL_TYPE ? value : undefined;
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
    mapping: BlueprintReferenceMapping
): Result<string | null | undefined, ApplyFluxerBotGuildStructureActionError> {
    if (!change) return ok(undefined);
    if (targetType === 'category') {
        return err({ type: 'invalid-value', field: 'parentId' });
    }

    if (change.after === null || change.after === undefined) return ok(null);
    if (typeof change.after !== 'string') return err({ type: 'invalid-value', field: 'parentId' });

    return normalizeOptionalStructureReference(change.after, mapping, 'parentId');
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

function normalizePermissionOverwriteReplacement(
    change: { field: string; before?: unknown; after: unknown } | undefined,
    mapping: BlueprintReferenceMapping
): Result<PermissionOverwriteReplacement | undefined, ApplyFluxerBotGuildStructureActionError> {
    if (!change) return ok(undefined);

    const before = normalizePermissionOverwrites(change.before, mapping);
    const after = normalizePermissionOverwrites(change.after, mapping);

    if (before.isErr()) return err(before.error);
    if (after.isErr()) return err(after.error);

    return ok({ before: before.value, after: after.value });
}

function normalizePermissionOverwrites(
    value: unknown,
    mapping: BlueprintReferenceMapping
): Result<PermissionOverwrite[], ApplyFluxerBotGuildStructureActionError> {
    if (!Array.isArray(value)) return err({ type: 'invalid-value', field: 'permissionOverwrites' });

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
            return err({ type: 'invalid-value', field: 'permissionOverwrites' });
        }

        const id = mapPermissionOverwriteId(overwrite.id.trim(), overwrite.type, mapping);
        if (!id) return err({ type: 'structure-reference-mapping-missing', field: 'permissionOverwrites' });

        overwrites.push({
            id,
            type: overwrite.type,
            allow: overwrite.allow,
            deny: overwrite.deny,
        });
    }

    return ok(overwrites);
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

        // DELETE is convergent: if the provider says the overwrite is already
        // absent, this provider step has reached its intended state.
        if (deleteResult.isErr() && deleteResult.error.type !== 'not-found') return err(deleteResult.error);
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

function mapPermissionOverwriteId(id: string, type: 0 | 1, mapping: BlueprintReferenceMapping): string | undefined {
    if (type === 1) return id;
    if (mapping.sourceGuildId && id === mapping.sourceGuildId) return mapping.guildId;
    return resolveBlueprintReference(id, mapping);
}

function permissionOverwriteKey(overwrite: PermissionOverwrite): string {
    return `${String(overwrite.type)}:${overwrite.id}`;
}

function stablePermissionOverwriteKey(overwrite: PermissionOverwrite): string {
    return `${String(overwrite.type)}:${overwrite.id}:${overwrite.allow}:${overwrite.deny}`;
}

function countPermissionOverwriteMutations(replacement: PermissionOverwriteReplacement): number {
    const beforeByKey = new Map(replacement.before.map((overwrite) => [permissionOverwriteKey(overwrite), overwrite]));
    const afterByKey = new Map(replacement.after.map((overwrite) => [permissionOverwriteKey(overwrite), overwrite]));
    const deletes = replacement.before.filter((overwrite) => !afterByKey.has(permissionOverwriteKey(overwrite))).length;
    const upserts = replacement.after.filter((overwrite) => {
        const before = beforeByKey.get(permissionOverwriteKey(overwrite));
        return !before || stablePermissionOverwriteKey(before) !== stablePermissionOverwriteKey(overwrite);
    }).length;
    return deletes + upserts;
}

function normalizeOptionalStructureReference(
    value: string | null,
    mapping: BlueprintReferenceMapping,
    field: 'parentId'
): Result<string | null, ApplyFluxerBotGuildStructureActionError> {
    if (!value) return ok(null);
    const mapped = resolveBlueprintReference(value, mapping);
    return mapped ? ok(mapped) : err({ type: 'structure-reference-mapping-missing', field });
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

function materializeStructureActionAuthority(
    authority: BlueprintActionAuthoritySnapshot,
    runIdMap: Readonly<Record<string, string>>
): BlueprintActionAuthoritySnapshot {
    const materializeTargetId = (targetId: string) => runIdMap[targetId] ?? targetId;
    return {
        idMap: Object.fromEntries(
            Object.entries(authority.idMap).map(([sourceId, targetId]) => [sourceId, materializeTargetId(targetId)])
        ),
        knownTargetKinds: Object.fromEntries(
            Object.entries(authority.knownTargetKinds).map(([targetId, kind]) => [materializeTargetId(targetId), kind])
        ),
    };
}

function toApplyReferenceValidationError(
    failure: BlueprintActionReferenceValidationFailure
): ApplyFluxerBotGuildStructureActionError {
    if (failure.errorType === 'invalid-value') {
        return {
            type: failure.errorType,
            actionId: failure.actionId,
            field: `${failure.actionId}.${failure.field ?? 'references'}`,
        };
    }
    if (failure.errorType === 'structure-reference-mapping-missing') {
        return {
            type: failure.errorType,
            actionId: failure.actionId,
            field:
                failure.field === 'parentId' || failure.field === 'permissionOverwrites' ? failure.field : 'targetId',
        };
    }
    if (failure.errorType === 'structure-reference-kind-mismatch') {
        return {
            type: failure.errorType,
            actionId: failure.actionId,
            field: failure.field === 'parentId' ? 'parentId' : 'targetId',
        };
    }
    return { type: failure.errorType, actionId: failure.actionId };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isRateLimitedApplyError(error: ApplyFluxerBotGuildStructureActionError): boolean {
    return error.type === 'operation-failed' && readApplyErrorStatus(error.error) === 429;
}

function classifyApplyMutationFailure(error: ApplyFluxerBotGuildStructureActionError): 'not-applied' | 'unknown' {
    if (error.type !== 'operation-failed') return 'not-applied';
    const status = readApplyErrorStatus(error.error);
    if (status === 408 || status === 499) return 'unknown';
    return status !== undefined && status >= 400 && status < 500 ? 'not-applied' : 'unknown';
}

function readApplyErrorStatus(error: unknown): number | undefined {
    const visited = new Set<object>();
    let current: unknown = error;
    while (typeof current === 'object' && current !== null && !visited.has(current)) {
        visited.add(current);
        const value = current as { cause?: unknown; status?: unknown; statusCode?: unknown };
        const status = value.status ?? value.statusCode;
        if (typeof status === 'number') return status;
        current = value.cause;
    }
    return undefined;
}

function readApplyRetryAfterMs(error: ApplyFluxerBotGuildStructureActionError): number | undefined {
    if (error.type !== 'operation-failed') return undefined;
    const visited = new Set<object>();
    let current: unknown = error.error;
    while (typeof current === 'object' && current !== null && !visited.has(current)) {
        visited.add(current);
        const value = current as {
            cause?: unknown;
            data?: unknown;
            headers?: { get?: (name: string) => string | null };
            retryAfter?: unknown;
            retryAfterMs?: unknown;
            retry_after?: unknown;
        };
        const directMs = numberValue(value.retryAfterMs);
        if (directMs !== undefined) return boundRetryAfterMs(directMs);
        const directSeconds = numberValue(value.retry_after ?? value.retryAfter);
        if (directSeconds !== undefined) return boundRetryAfterMs(directSeconds * 1_000);
        const header = value.headers?.get?.('Retry-After');
        if (header) {
            const seconds = Number(header);
            const parsed = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - Date.now();
            if (Number.isFinite(parsed)) return boundRetryAfterMs(parsed);
        }
        current = value.cause ?? value.data;
    }
    return undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function boundRetryAfterMs(value: number): number {
    return Math.min(15 * 60_000, Math.max(1_000, Math.ceil(value)));
}
