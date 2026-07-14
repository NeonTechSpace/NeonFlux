import type { BlueprintChannelOrderEntry, BlueprintRoleOrderEntry } from './plan.js';

export type { BlueprintChannelOrderEntry, BlueprintRoleOrderEntry } from './plan.js';

export type BlueprintActionForValidation = {
    id: string;
    actionType: string;
    targetType: string;
    targetId?: string;
    changes?: Array<{ field: string; before?: unknown; after: unknown }>;
    after?: unknown;
};

export type BlueprintReferenceMapping = {
    guildId: string;
    idMap: Readonly<Record<string, string>>;
    knownTargetIds: ReadonlySet<string>;
    sourceGuildId?: string;
};

export type BlueprintTargetKind = 'role' | 'category' | 'channel';

export type BlueprintActionReferenceValidationResult =
    | { ok: true }
    | {
          ok: false;
          actionId: string;
          errorType:
              | 'invalid-value'
              | 'structure-order-mapping-missing'
              | 'structure-order-plan-invalid'
              | 'structure-reference-kind-mismatch'
              | 'structure-reference-mapping-missing';
          field?: 'changes' | 'parentId' | 'permissionOverwrites' | 'targetId';
      };

export type BlueprintActionReferenceValidationFailure = Exclude<BlueprintActionReferenceValidationResult, { ok: true }>;

type BlueprintActionReferenceValidationError = Omit<BlueprintActionReferenceValidationFailure, 'actionId' | 'ok'>;

type BlueprintOrderNormalizationResult<T> =
    | { ok: true; positions: T }
    | { ok: false; errorType: 'structure-order-mapping-missing' | 'structure-order-plan-invalid' };

export type BlueprintActionAuthoritySnapshot = {
    idMap: Record<string, string>;
    knownTargetKinds: Record<string, BlueprintTargetKind>;
};

export type BlueprintActionAuthorityProgressionResult<TVisitorError> =
    | (BlueprintActionAuthoritySnapshot & {
          durableIdMap: Record<string, string>;
          ok: true;
          steps: BlueprintActionAuthoritySnapshot[];
      })
    | {
          actionId: string;
          failure:
              | { type: 'reference'; error: BlueprintActionReferenceValidationError }
              | { type: 'visitor'; error: TVisitorError };
          ok: false;
      };

export function createBlueprintReferenceMapping(input: {
    guildId: string;
    idMap?: Record<string, string>;
    knownTargetIds?: readonly string[];
    knownTargetKinds?: Readonly<Record<string, BlueprintTargetKind>>;
    sourceGuildId?: string;
}): BlueprintReferenceMapping {
    return {
        guildId: input.guildId,
        idMap: input.idMap ?? {},
        knownTargetIds: new Set(
            [...(input.knownTargetIds ?? []), ...Object.keys(input.knownTargetKinds ?? {})]
                .map((id) => id.trim())
                .filter(Boolean)
        ),
        ...(input.sourceGuildId ? { sourceGuildId: input.sourceGuildId } : {}),
    };
}

export function resolveBlueprintReference(id: string, mapping: BlueprintReferenceMapping): string | undefined {
    return mapping.idMap[id] ?? (mapping.knownTargetIds.has(id) ? id : undefined);
}

export function validateBlueprintActionReferences(input: {
    actions: readonly BlueprintActionForValidation[];
    guildId: string;
    idMap?: Record<string, string>;
    knownTargetKinds: Readonly<Record<string, BlueprintTargetKind>>;
    sourceGuildId?: string;
}): BlueprintActionReferenceValidationResult {
    const progression = simulateBlueprintActionAuthority(input);
    if (progression.ok) return { ok: true };
    if (progression.failure.type === 'visitor') return invalidAuthority(input.actions);
    return { ok: false, actionId: progression.actionId, ...progression.failure.error };
}

export function simulateBlueprintActionAuthority<TVisitorError = never>(input: {
    actions: readonly BlueprintActionForValidation[];
    guildId: string;
    idMap?: Record<string, string>;
    knownTargetKinds: Readonly<Record<string, BlueprintTargetKind>>;
    resolveCreatedTargetId?: (sourceId: string, action: BlueprintActionForValidation) => string | undefined;
    sourceGuildId?: string;
    visitAction?: (
        action: BlueprintActionForValidation,
        authority: BlueprintActionAuthoritySnapshot
    ) => TVisitorError | undefined;
}): BlueprintActionAuthorityProgressionResult<TVisitorError> {
    const kinds = new Map<string, BlueprintTargetKind>();
    const available = new Set<string>();
    const failReference = (
        actionId: string,
        error: BlueprintActionReferenceValidationError
    ): BlueprintActionAuthorityProgressionResult<TVisitorError> => ({
        actionId,
        failure: { type: 'reference', error },
        ok: false,
    });
    for (const [idValue, kind] of Object.entries(input.knownTargetKinds)) {
        const id = idValue.trim();
        if (!id || id !== idValue || !isBlueprintTargetKind(kind) || kinds.has(id)) {
            return failReference(input.actions[0]?.id ?? 'provider-steps', {
                errorType: 'invalid-value',
                field: 'targetId',
            });
        }
        kinds.set(id, kind);
        available.add(id);
    }
    if (kinds.get(input.guildId) !== 'role') {
        return failReference(input.actions[0]?.id ?? 'provider-steps', {
            errorType: 'invalid-value',
            field: 'targetId',
        });
    }

    const aliases = new Map<string, string>();
    const aliasedTargets = new Set<string>();
    for (const [sourceValue, targetValue] of Object.entries(input.idMap ?? {})) {
        const sourceId = sourceValue.trim();
        const targetId = targetValue.trim();
        if (
            !sourceId ||
            sourceId !== sourceValue ||
            !targetId ||
            targetId !== targetValue ||
            !available.has(targetId) ||
            aliasedTargets.has(targetId)
        ) {
            return failReference(input.actions[0]?.id ?? 'provider-steps', {
                errorType: 'invalid-value',
                field: 'targetId',
            });
        }
        aliases.set(sourceId, targetId);
        aliasedTargets.add(targetId);
    }
    const resolve = (idValue: string): { id: string; kind: BlueprintTargetKind } | undefined => {
        const id = idValue.trim();
        if (!id) return undefined;
        const targetId = aliases.get(id) ?? id;
        const kind = kinds.get(targetId);
        return kind && available.has(targetId) ? { id: targetId, kind } : undefined;
    };
    const resolveRoleOverwrite = (id: string): { id: string; kind: 'role' } | undefined => {
        if (input.sourceGuildId && id.trim() === input.sourceGuildId) {
            return available.has(input.guildId) && kinds.get(input.guildId) === 'role'
                ? { id: input.guildId, kind: 'role' as const }
                : undefined;
        }
        const resolved = resolve(id);
        return resolved?.kind === 'role' ? { id: resolved.id, kind: 'role' } : undefined;
    };
    const durableIdMap: Record<string, string> = { ...(input.idMap ?? {}) };
    const steps: BlueprintActionAuthoritySnapshot[] = [];
    const snapshot = (): BlueprintActionAuthoritySnapshot => ({
        idMap: Object.fromEntries([...aliases].filter(([, targetId]) => available.has(targetId))),
        knownTargetKinds: Object.fromEntries([...kinds].filter(([targetId]) => available.has(targetId))),
    });

    for (const action of input.actions) {
        const referenceError = validateActionReferences(action, resolve, resolveRoleOverwrite);
        if (referenceError) return failReference(action.id, referenceError);
        const authority = snapshot();
        if (action.actionType === 'create') {
            const sourceId = action.targetId?.trim() ?? '';
            const kind = actionTargetKind(action.targetType);
            if (!sourceId || !kind || resolve(sourceId) || sourceId === input.sourceGuildId) {
                return failReference(action.id, { errorType: 'invalid-value', field: 'targetId' });
            }
            const visitorError = input.visitAction?.(action, authority);
            if (visitorError !== undefined) {
                return { actionId: action.id, failure: { type: 'visitor', error: visitorError }, ok: false };
            }
            steps.push(authority);
            const usesProviderIds = input.resolveCreatedTargetId !== undefined;
            const targetId = usesProviderIds ? input.resolveCreatedTargetId?.(sourceId, action) : sourceId;
            if (!targetId?.trim() || targetId !== targetId.trim() || (usesProviderIds && kinds.has(targetId))) {
                return failReference(action.id, { errorType: 'invalid-value', field: 'targetId' });
            }
            durableIdMap[sourceId] = targetId;
            aliases.set(sourceId, targetId);
            kinds.set(targetId, kind);
            available.add(targetId);
        } else if (action.actionType === 'delete' && action.targetId) {
            const visitorError = input.visitAction?.(action, authority);
            if (visitorError !== undefined) {
                return { actionId: action.id, failure: { type: 'visitor', error: visitorError }, ok: false };
            }
            steps.push(authority);
            const resolved = resolve(action.targetId);
            if (resolved) {
                available.delete(resolved.id);
                for (const [sourceId, targetId] of aliases) {
                    if (targetId === resolved.id) aliases.delete(sourceId);
                }
            }
        } else {
            const visitorError = input.visitAction?.(action, authority);
            if (visitorError !== undefined) {
                return { actionId: action.id, failure: { type: 'visitor', error: visitorError }, ok: false };
            }
            steps.push(authority);
        }
    }

    return { ...snapshot(), durableIdMap, ok: true, steps };
}

export function deriveBlueprintCursorAuthority(input: {
    actions: readonly BlueprintActionForValidation[];
    cursor: number;
    runIdMap: Readonly<Record<string, string>>;
    guildId: string;
    initialIdMap: Record<string, string>;
    knownTargetKinds: Readonly<Record<string, BlueprintTargetKind>>;
    sourceGuildId?: string;
}):
    | { ok: true; idMap: Record<string, string>; knownTargetKinds: Record<string, BlueprintTargetKind> }
    | BlueprintActionReferenceValidationFailure {
    const graphValidation = validateBlueprintActionReferences({
        actions: input.actions,
        guildId: input.guildId,
        idMap: input.initialIdMap,
        knownTargetKinds: input.knownTargetKinds,
        ...(input.sourceGuildId ? { sourceGuildId: input.sourceGuildId } : {}),
    });
    if (!graphValidation.ok) return graphValidation;
    if (!Number.isInteger(input.cursor) || input.cursor < 0 || input.cursor > input.actions.length) {
        return invalidAuthority(input.actions);
    }

    const replay = simulateBlueprintActionAuthority({
        actions: input.actions.slice(0, input.cursor),
        guildId: input.guildId,
        idMap: input.initialIdMap,
        knownTargetKinds: input.knownTargetKinds,
        resolveCreatedTargetId: (sourceId) => input.runIdMap[sourceId],
        ...(input.sourceGuildId ? { sourceGuildId: input.sourceGuildId } : {}),
    });
    if (!replay.ok) {
        return replay.failure.type === 'reference'
            ? { ok: false, actionId: replay.actionId, ...replay.failure.error }
            : invalidAuthority(input.actions);
    }
    if (!sameStringRecord(replay.durableIdMap, input.runIdMap)) return invalidAuthority(input.actions);

    return {
        ok: true,
        idMap: replay.idMap,
        knownTargetKinds: replay.knownTargetKinds,
    };
}

function validateActionReferences(
    action: BlueprintActionForValidation,
    resolve: (id: string) => { id: string; kind: BlueprintTargetKind } | undefined,
    resolveRoleOverwrite: (id: string) => { id: string; kind: 'role' } | undefined
): BlueprintActionReferenceValidationError | undefined {
    if (action.targetType === 'channel-order') {
        if (!Array.isArray(action.after) || action.after.length === 0) {
            return { errorType: 'structure-order-plan-invalid' };
        }
        const errorType = validateChannelOrderReferences(action.after as BlueprintChannelOrderEntry[], resolve);
        return errorType ? { errorType } : undefined;
    }
    if (action.targetType === 'role-order') {
        if (!Array.isArray(action.after) || action.after.length === 0) {
            return { errorType: 'structure-order-plan-invalid' };
        }
        const errorType = validateRoleOrderReferences(action.after as BlueprintRoleOrderEntry[], resolve);
        return errorType ? { errorType } : undefined;
    }

    if (
        (action.actionType === 'update' || action.actionType === 'delete') &&
        (typeof action.targetId !== 'string' || !action.targetId.trim())
    ) {
        return { errorType: 'structure-reference-mapping-missing', field: 'targetId' };
    }
    if (action.actionType === 'update' || action.actionType === 'delete') {
        const resolved = resolve(action.targetId ?? '');
        const expectedKind = actionTargetKind(action.targetType);
        if (!resolved) return { errorType: 'structure-reference-mapping-missing', field: 'targetId' };
        if (!expectedKind || resolved.kind !== expectedKind) {
            return { errorType: 'structure-reference-kind-mismatch', field: 'targetId' };
        }
    }

    if (action.actionType === 'create' && isRecord(action.after)) {
        if (typeof action.after.parentId === 'string') {
            const parent = resolve(action.after.parentId);
            if (!parent) return { errorType: 'structure-reference-mapping-missing', field: 'parentId' };
            if (parent.kind !== 'category') {
                return { errorType: 'structure-reference-kind-mismatch', field: 'parentId' };
            }
        }
        if (action.targetType === 'category' || action.targetType === 'channel') {
            const overwriteError = validatePermissionOverwriteReferences(
                action.after.permissionOverwrites,
                resolveRoleOverwrite
            );
            if (overwriteError) return { errorType: overwriteError, field: 'permissionOverwrites' };
        }
    }

    if (action.actionType === 'update') {
        for (const change of action.changes ?? []) {
            if (change.field === 'parentId' && typeof change.after === 'string') {
                const parent = resolve(change.after);
                if (!parent) return { errorType: 'structure-reference-mapping-missing', field: 'parentId' };
                if (parent.kind !== 'category') {
                    return { errorType: 'structure-reference-kind-mismatch', field: 'parentId' };
                }
            }
            if (change.field === 'permissionOverwrites') {
                const beforeError = validatePermissionOverwriteReferences(change.before, resolveRoleOverwrite);
                if (beforeError) return { errorType: beforeError, field: 'permissionOverwrites' };
                const afterError = validatePermissionOverwriteReferences(change.after, resolveRoleOverwrite);
                if (afterError) return { errorType: afterError, field: 'permissionOverwrites' };
            }
        }
    }

    return undefined;
}

function validatePermissionOverwriteReferences(
    value: unknown,
    resolveRoleOverwrite: (id: string) => { id: string; kind: 'role' } | undefined
): 'invalid-value' | 'structure-reference-mapping-missing' | undefined {
    if (!Array.isArray(value)) return 'invalid-value';
    for (const overwrite of value) {
        if (
            !isRecord(overwrite) ||
            typeof overwrite.id !== 'string' ||
            !overwrite.id.trim() ||
            (overwrite.type !== 0 && overwrite.type !== 1)
        ) {
            return 'invalid-value';
        }
        if (overwrite.type === 0 && !resolveRoleOverwrite(overwrite.id)) {
            return 'structure-reference-mapping-missing';
        }
    }
    return undefined;
}

function validateChannelOrderReferences(
    order: BlueprintChannelOrderEntry[],
    resolve: (id: string) => { id: string; kind: BlueprintTargetKind } | undefined
): 'structure-order-mapping-missing' | 'structure-order-plan-invalid' | undefined {
    const sourceIds = new Set<string>();
    for (const item of order) {
        if (
            !isRecord(item) ||
            typeof item.sourceId !== 'string' ||
            !item.sourceId.trim() ||
            (item.parentSourceId !== null &&
                (typeof item.parentSourceId !== 'string' || !item.parentSourceId.trim())) ||
            !Number.isInteger(item.position) ||
            item.position < 0 ||
            sourceIds.has(item.sourceId.trim())
        ) {
            return 'structure-order-plan-invalid';
        }
        sourceIds.add(item.sourceId.trim());
        const target = resolve(item.sourceId);
        if (!target || (target.kind !== 'category' && target.kind !== 'channel')) {
            return 'structure-order-mapping-missing';
        }
        const parent = item.parentSourceId ? resolve(item.parentSourceId) : undefined;
        if (item.parentSourceId && parent?.kind !== 'category') {
            return 'structure-order-mapping-missing';
        }
    }
    return undefined;
}

function validateRoleOrderReferences(
    order: BlueprintRoleOrderEntry[],
    resolve: (id: string) => { id: string; kind: BlueprintTargetKind } | undefined
): 'structure-order-mapping-missing' | 'structure-order-plan-invalid' | undefined {
    const sourceIds = new Set<string>();
    for (const item of order) {
        if (
            !isRecord(item) ||
            typeof item.sourceId !== 'string' ||
            !item.sourceId.trim() ||
            !Number.isInteger(item.position) ||
            item.position <= 0 ||
            (item.hierarchyRank !== undefined && (!Number.isInteger(item.hierarchyRank) || item.hierarchyRank < 0)) ||
            sourceIds.has(item.sourceId.trim())
        ) {
            return 'structure-order-plan-invalid';
        }
        sourceIds.add(item.sourceId.trim());
        if (resolve(item.sourceId)?.kind !== 'role') return 'structure-order-mapping-missing';
    }
    return undefined;
}

function invalidAuthority(actions: readonly BlueprintActionForValidation[]): BlueprintActionReferenceValidationFailure {
    return {
        ok: false,
        actionId: actions[0]?.id ?? 'provider-steps',
        errorType: 'invalid-value',
        field: 'targetId',
    };
}

function actionTargetKind(targetType: string): BlueprintTargetKind | undefined {
    return targetType === 'role' || targetType === 'category' || targetType === 'channel' ? targetType : undefined;
}

function isBlueprintTargetKind(value: unknown): value is BlueprintTargetKind {
    return value === 'role' || value === 'category' || value === 'channel';
}

function sameStringRecord(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
    const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export function normalizeRequestedChannelPositions(
    channelOrder: BlueprintChannelOrderEntry[],
    mapping: BlueprintReferenceMapping
): BlueprintOrderNormalizationResult<Array<{ channelId: string; parentId: string | null; position: number }>> {
    const grouped = new Map<string, BlueprintChannelOrderEntry[]>();
    const seenSourceIds = new Set<string>();
    for (const channel of channelOrder) {
        if (
            typeof channel.sourceId !== 'string' ||
            !channel.sourceId.trim() ||
            (channel.parentSourceId !== null &&
                (typeof channel.parentSourceId !== 'string' || !channel.parentSourceId.trim())) ||
            !Number.isInteger(channel.position) ||
            channel.position < 0
        ) {
            return { ok: false, errorType: 'structure-order-plan-invalid' };
        }
        const sourceId = channel.sourceId.trim();
        if (seenSourceIds.has(sourceId)) return { ok: false, errorType: 'structure-order-plan-invalid' };
        seenSourceIds.add(sourceId);
        const parentSourceId = channel.parentSourceId === null ? '' : channel.parentSourceId.trim();
        grouped.set(parentSourceId, [...(grouped.get(parentSourceId) ?? []), channel]);
    }

    const positions: Array<{ channelId: string; parentId: string | null; position: number }> = [];
    const seenTargetIds = new Set<string>();
    for (const [parentSourceId, channels] of [...grouped.entries()].sort(([left], [right]) =>
        left === '' ? -1 : right === '' ? 1 : left.localeCompare(right)
    )) {
        const parentId = parentSourceId ? resolveBlueprintReference(parentSourceId, mapping) : null;
        if (parentSourceId && !parentId) return { ok: false, errorType: 'structure-order-mapping-missing' };
        const resolvedParentId = parentId ?? null;
        for (const [position, channel] of [...channels]
            .sort((left, right) => left.position - right.position || left.sourceId.localeCompare(right.sourceId))
            .entries()) {
            const channelId = resolveBlueprintReference(channel.sourceId.trim(), mapping);
            if (!channelId) return { ok: false, errorType: 'structure-order-mapping-missing' };
            if (seenTargetIds.has(channelId)) return { ok: false, errorType: 'structure-order-plan-invalid' };
            seenTargetIds.add(channelId);
            positions.push({ channelId, parentId: resolvedParentId, position });
        }
    }
    return { ok: true, positions };
}

export function normalizeRequestedRolePositions(
    roleOrder: BlueprintRoleOrderEntry[],
    mapping: BlueprintReferenceMapping
): BlueprintOrderNormalizationResult<Array<{ roleId: string; position: number }>> {
    const seenSourceIds = new Set<string>();
    for (const role of roleOrder) {
        if (
            typeof role.sourceId !== 'string' ||
            !role.sourceId.trim() ||
            !Number.isInteger(role.position) ||
            role.position <= 0 ||
            (role.hierarchyRank !== undefined && (!Number.isInteger(role.hierarchyRank) || role.hierarchyRank < 0))
        ) {
            return { ok: false, errorType: 'structure-order-plan-invalid' };
        }
        const sourceId = role.sourceId.trim();
        if (seenSourceIds.has(sourceId)) return { ok: false, errorType: 'structure-order-plan-invalid' };
        seenSourceIds.add(sourceId);
    }

    const positions: Array<{ roleId: string; position: number }> = [];
    const seenTargetIds = new Set<string>();
    for (const role of [...roleOrder].sort(compareRequestedRoleOrder)) {
        const targetId = resolveBlueprintReference(role.sourceId.trim(), mapping);
        if (!targetId) return { ok: false, errorType: 'structure-order-mapping-missing' };
        if (seenTargetIds.has(targetId)) return { ok: false, errorType: 'structure-order-plan-invalid' };
        seenTargetIds.add(targetId);
        positions.push({ roleId: targetId, position: role.position });
    }
    return { ok: true, positions };
}

function compareRequestedRoleOrder(left: BlueprintRoleOrderEntry, right: BlueprintRoleOrderEntry): number {
    if (left.hierarchyRank !== undefined && right.hierarchyRank !== undefined) {
        return left.hierarchyRank - right.hierarchyRank;
    }
    if (left.hierarchyRank !== undefined) return -1;
    if (right.hierarchyRank !== undefined) return 1;
    return right.position - left.position || left.sourceId.localeCompare(right.sourceId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
