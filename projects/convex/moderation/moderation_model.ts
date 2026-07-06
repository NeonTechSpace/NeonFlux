import type { GenericId } from 'convex/values';

export type ModerationCaseInput = {
    action?: string | null;
    actorUserId?: string | null;
    caseNumber?: number | null;
    createdAt?: string | null;
    guildId?: string | null;
    reason?: string | null;
    status?: string | null;
    targetChannelId?: string | null;
    targetType?: string | null;
    targetUserId?: string | null;
    updatedAt?: string | null;
};

export type ModerationCaseDocument = {
    action: string;
    actorUserId?: string;
    caseNumber: number;
    createdAt: string;
    guildId: string;
    reason?: string;
    status: string;
    targetChannelId?: string;
    targetType: 'channel' | 'user';
    targetUserId?: string;
    updatedAt: string;
};

export type ModerationCaseRecord = {
    action: string;
    actorUserId: string | null;
    caseNumber: number;
    createdAt: string;
    guildId: string;
    id: string;
    reason: string | null;
    status: string;
    targetChannelId: string | null;
    targetType: 'channel' | 'user';
    targetUserId: string | null;
    updatedAt: string;
};

export type ModerationCaseEventInput = {
    actorUserId?: string | null;
    caseId?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    eventType?: string | null;
};

export type ModerationCaseEventDocument = {
    actorUserId?: string;
    caseId: GenericId<'moderationCases'>;
    createdAt: string;
    details: Record<string, unknown>;
    eventType: string;
};

export type ModerationCaseEventRecord = {
    actorUserId: string | null;
    caseId: string;
    createdAt: string;
    details: Record<string, unknown>;
    eventType: string;
    id: string;
};

export type ModerationTemporaryActionInput = {
    action?: string | null;
    caseId?: string | null;
    createdAt?: string | null;
    expiresAt?: string | null;
    guildId?: string | null;
    status?: string | null;
    targetUserId?: string | null;
    updatedAt?: string | null;
};

export type ModerationTemporaryActionDocument = {
    action: string;
    caseId?: GenericId<'moderationCases'>;
    createdAt: string;
    expiresAt: string;
    guildId: string;
    status: ModerationTemporaryActionStatus;
    targetUserId: string;
    updatedAt: string;
};

export type ModerationTemporaryActionRecord = {
    action: string;
    caseId: string | null;
    createdAt: string;
    expiresAt: string;
    guildId: string;
    id: string;
    status: ModerationTemporaryActionStatus;
    targetUserId: string;
    updatedAt: string;
};

export type ModerationTemporaryActionStatus = 'cancelled' | 'completed' | 'failed' | 'pending';

export type ModerationInputError =
    | { field: string; type: 'invalid-value' | 'missing-input' }
    | { from: string; to: string; type: 'invalid-status-transition' };

export type ModerationInputResult<Value> = { ok: true; value: Value } | { error: ModerationInputError; ok: false };

const caseStatusTransitions = new Map<string, readonly string[]>([
    ['open', ['resolved', 'void']],
    ['resolved', []],
    ['void', []],
]);

const temporaryActionStatusTransitions = new Map<string, readonly string[]>([
    ['pending', ['completed', 'failed', 'cancelled']],
    ['completed', []],
    ['failed', []],
    ['cancelled', []],
]);

export function buildModerationCaseDocument(
    input: ModerationCaseInput,
    now: string
): ModerationInputResult<ModerationCaseDocument> {
    const normalized = normalizeModerationCaseInput(input);
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!normalized.ok) return normalized;
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            ...normalized.value,
            createdAt,
            updatedAt,
        },
    };
}

export function buildModerationCaseEventDocument(
    input: ModerationCaseEventInput,
    now: string
): ModerationInputResult<ModerationCaseEventDocument> {
    const caseId = normalizeRequiredString(input.caseId, 'caseId');
    const eventType = normalizeRequiredString(input.eventType, 'eventType');
    const details = normalizeRecord(input.details ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!caseId.ok) return caseId;
    if (!eventType.ok) return eventType;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    const actorUserId = normalizeOptionalString(input.actorUserId);

    return {
        ok: true,
        value: {
            ...(actorUserId ? { actorUserId } : {}),
            caseId: caseId.value as GenericId<'moderationCases'>,
            createdAt,
            details,
            eventType: eventType.value,
        },
    };
}

export function buildModerationTemporaryActionDocument(
    input: ModerationTemporaryActionInput,
    now: string
): ModerationInputResult<ModerationTemporaryActionDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const action = normalizeRequiredString(input.action, 'action');
    const targetUserId = normalizeRequiredString(input.targetUserId, 'targetUserId');
    const expiresAt = normalizeTimestamp(input.expiresAt);
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const status = normalizeTemporaryActionStatus(input.status ?? 'pending');

    if (!guildId.ok) return guildId;
    if (!action.ok) return action;
    if (!targetUserId.ok) return targetUserId;
    if (!expiresAt) return { error: { field: 'expiresAt', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (!status.ok) return status;

    const caseId = normalizeOptionalString(input.caseId);

    return {
        ok: true,
        value: {
            action: action.value,
            ...(caseId ? { caseId: caseId as GenericId<'moderationCases'> } : {}),
            createdAt,
            expiresAt,
            guildId: guildId.value,
            status: status.value,
            targetUserId: targetUserId.value,
            updatedAt,
        },
    };
}

export function buildCaseStatusPatch(
    currentStatus: string,
    nextStatus: string,
    now: string
): ModerationInputResult<{ status: string; updatedAt: string }> {
    const status = normalizeRequiredString(nextStatus, 'status');

    if (!status.ok) return status;

    const transition = assertAllowedStatusTransition(currentStatus, status.value, caseStatusTransitions);

    if (!transition.ok) return transition;

    return { ok: true, value: { status: status.value, updatedAt: now } };
}

export function buildTemporaryActionStatusPatch(
    currentStatus: string,
    nextStatus: string,
    now: string
): ModerationInputResult<{ status: ModerationTemporaryActionStatus; updatedAt: string }> {
    const status = normalizeTemporaryActionStatus(nextStatus);

    if (!status.ok) return status;

    const transition = assertAllowedStatusTransition(currentStatus, status.value, temporaryActionStatusTransitions);

    if (!transition.ok) return transition;

    return { ok: true, value: { status: status.value, updatedAt: now } };
}

export function normalizeModerationListLimit(limit: number | undefined, fallback = 5, max = 100): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;

    return Math.min(Math.max(Math.trunc(limit), 1), max);
}

export function normalizeRequiredCaseId(value: string): ModerationInputResult<string> {
    return normalizeRequiredString(value, 'caseId');
}

export function normalizeRequiredGuildId(value: string): ModerationInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredTemporaryActionId(value: string): ModerationInputResult<string> {
    return normalizeRequiredString(value, 'id');
}

export function normalizeSinceTimestamp(value: string): ModerationInputResult<string> {
    const timestamp = normalizeTimestamp(value);

    return timestamp ? { ok: true, value: timestamp } : { error: { field: 'since', type: 'invalid-value' }, ok: false };
}

export function toModerationCaseRecord(document: ModerationCaseDocument & { _id: string }): ModerationCaseRecord {
    return {
        action: document.action,
        actorUserId: document.actorUserId ?? null,
        caseNumber: document.caseNumber,
        createdAt: document.createdAt,
        guildId: document.guildId,
        id: document._id,
        reason: document.reason ?? null,
        status: document.status,
        targetChannelId: document.targetChannelId ?? null,
        targetType: document.targetType,
        targetUserId: document.targetUserId ?? null,
        updatedAt: document.updatedAt,
    };
}

export function toModerationCaseEventRecord(
    document: ModerationCaseEventDocument & { _id: string }
): ModerationCaseEventRecord {
    return {
        actorUserId: document.actorUserId ?? null,
        caseId: document.caseId,
        createdAt: document.createdAt,
        details: document.details,
        eventType: document.eventType,
        id: document._id,
    };
}

export function toModerationTemporaryActionRecord(
    document: ModerationTemporaryActionDocument & { _id: string }
): ModerationTemporaryActionRecord {
    return {
        action: document.action,
        caseId: document.caseId ?? null,
        createdAt: document.createdAt,
        expiresAt: document.expiresAt,
        guildId: document.guildId,
        id: document._id,
        status: document.status,
        targetUserId: document.targetUserId,
        updatedAt: document.updatedAt,
    };
}

function normalizeModerationCaseInput(
    input: ModerationCaseInput
): ModerationInputResult<Omit<ModerationCaseDocument, 'createdAt' | 'updatedAt'>> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const action = normalizeRequiredString(input.action, 'action');
    const targetType = normalizeTargetType(input.targetType ?? 'user');
    const caseNumber = normalizePositiveInteger(input.caseNumber, 'caseNumber');

    if (!guildId.ok) return guildId;
    if (!action.ok) return action;
    if (!targetType.ok) return targetType;
    if (!caseNumber.ok) return caseNumber;

    const actorUserId = normalizeOptionalString(input.actorUserId);
    const reason = normalizeOptionalString(input.reason);
    const targetUserId = normalizeOptionalString(input.targetUserId);
    const targetChannelId = normalizeOptionalString(input.targetChannelId);

    if (targetType.value === 'user' && !targetUserId) {
        return { error: { field: 'targetUserId', type: 'missing-input' }, ok: false };
    }

    if (targetType.value === 'channel' && !targetChannelId) {
        return { error: { field: 'targetChannelId', type: 'missing-input' }, ok: false };
    }

    return {
        ok: true,
        value: {
            action: action.value,
            ...(actorUserId ? { actorUserId } : {}),
            caseNumber: caseNumber.value,
            guildId: guildId.value,
            ...(reason ? { reason } : {}),
            status: normalizeOptionalString(input.status) ?? 'open',
            ...(targetChannelId ? { targetChannelId } : {}),
            targetType: targetType.value,
            ...(targetUserId ? { targetUserId } : {}),
        },
    };
}

function normalizePositiveInteger(value: number | null | undefined, field: string): ModerationInputResult<number> {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        return { error: { field, type: 'invalid-value' }, ok: false };
    }

    return { ok: true, value };
}

function normalizeTargetType(value: string | null | undefined): ModerationInputResult<'channel' | 'user'> {
    if (value === 'channel' || value === 'user') {
        return { ok: true, value };
    }

    return { error: { field: 'targetType', type: 'invalid-value' }, ok: false };
}

function normalizeTemporaryActionStatus(
    value: string | null | undefined
): ModerationInputResult<ModerationTemporaryActionStatus> {
    const status = normalizeRequiredString(value, 'status');

    if (!status.ok) return status;
    if (!temporaryActionStatusTransitions.has(status.value)) {
        return { error: { field: 'status', type: 'invalid-value' }, ok: false };
    }

    return { ok: true, value: status.value as ModerationTemporaryActionStatus };
}

function assertAllowedStatusTransition(
    from: string,
    to: string,
    transitions: ReadonlyMap<string, readonly string[]>
): ModerationInputResult<void> {
    if (from === to) {
        return { ok: true, value: undefined };
    }

    if (!transitions.get(from)?.includes(to)) {
        return { error: { from, to, type: 'invalid-status-transition' }, ok: false };
    }

    return { ok: true, value: undefined };
}

function normalizeRequiredString(value: string | null | undefined, field: string): ModerationInputResult<string> {
    const normalizedValue = normalizeOptionalString(value);

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
