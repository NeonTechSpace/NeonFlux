export type StructureExportSnapshotInput = {
    createdAt?: string | null;
    createdByUserId?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    snapshot?: Record<string, unknown> | null;
    source?: string | null;
};

export type StructureExportSnapshotDocument = {
    createdAt: string;
    createdByUserId?: string;
    guildId: string;
    legacyId: string;
    snapshot: Record<string, unknown>;
    source: string;
};

export type StructureImportRunInput = {
    appliedAt?: string | null;
    confirmedAt?: string | null;
    createdAt?: string | null;
    createdByUserId?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    plan?: Record<string, unknown> | null;
    sourceSnapshotId?: string | null;
    status?: string | null;
    updatedAt?: string | null;
};

export type StructureImportRunDocument = {
    appliedAt?: string;
    confirmedAt?: string;
    createdAt: string;
    createdByUserId?: string;
    guildId: string;
    legacyId: string;
    plan: Record<string, unknown>;
    sourceSnapshotLegacyId?: string;
    status: string;
    updatedAt: string;
};

export type StructureImportActionInput = {
    actionType?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    legacyId?: string | null;
    runId?: string | null;
    status?: string | null;
    targetId?: string | null;
    targetType?: string | null;
    updatedAt?: string | null;
};

export type StructureImportActionDocument = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    legacyId: string;
    runLegacyId: string;
    status: string;
    targetId?: string;
    targetType: string;
    updatedAt: string;
};

export type StructureObservedEventStateDocument = {
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    feature: 'import_export';
    guildId: string;
    legacyId: string;
    updatedAt: string;
};

export type StructureExportSnapshotRecord = {
    createdAt: string;
    createdByUserId: string | null;
    guildId: string;
    id: string;
    snapshot: Record<string, unknown>;
    source: string;
};

export type StructureImportRunRecord = {
    appliedAt: string | null;
    confirmedAt: string | null;
    createdAt: string;
    createdByUserId: string | null;
    guildId: string;
    id: string;
    plan: Record<string, unknown>;
    sourceSnapshotId: string | null;
    status: string;
    updatedAt: string;
};

export type StructureImportActionRecord = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    id: string;
    runId: string;
    status: string;
    targetId: string | null;
    targetType: string;
    updatedAt: string;
};

export type StructureImportRunWithActionsRecord = StructureImportRunRecord & {
    actions: StructureImportActionRecord[];
};

export type StructureObservedEventStateRecord = {
    createdAt?: string;
    guildId: string;
    lastEventType?: string;
    lastObservedAt?: string;
    lastTargetId?: string;
    lastTargetType?: string;
    observedChangeCount: number;
    updatedAt?: string;
};

export type StructureInputError =
    | { field: string; type: 'invalid-value' | 'missing-input' }
    | { from: string; to: string; type: 'invalid-status-transition' };
export type StructureInputResult<Value> = { ok: true; value: Value } | { error: StructureInputError; ok: false };
export type StructureImportRunStatusPatch = {
    appliedAt?: string;
    confirmedAt?: string;
    plan: Record<string, unknown>;
    status: string;
    updatedAt: string;
};

const importRunStatusTransitions = new Map<string, readonly string[]>([
    ['draft', ['dry_run_complete', 'cancelled']],
    ['dry_run_complete', ['confirmed', 'cancelled']],
    ['confirmed', ['applying', 'cancelled']],
    ['applying', ['applied', 'failed']],
    ['applied', []],
    ['cancelled', []],
    ['failed', []],
]);

export function buildStructureExportSnapshotDocument(
    input: StructureExportSnapshotInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): StructureInputResult<StructureExportSnapshotDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const snapshot = normalizeRecord(input.snapshot);
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!guildId.ok) return guildId;
    if (!snapshot) return { error: { field: 'snapshot', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    const createdByUserId = normalizeOptionalString(input.createdByUserId);

    return {
        ok: true,
        value: {
            createdAt,
            ...(createdByUserId ? { createdByUserId } : {}),
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            snapshot,
            source: normalizeOptionalString(input.source) ?? 'bot',
        },
    };
}

export function buildStructureImportRunDocument(
    input: StructureImportRunInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): StructureInputResult<StructureImportRunDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const plan = normalizeRecord(input.plan ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const confirmedAt = input.confirmedAt === undefined ? undefined : normalizeTimestamp(input.confirmedAt);
    const appliedAt = input.appliedAt === undefined ? undefined : normalizeTimestamp(input.appliedAt);

    if (!guildId.ok) return guildId;
    if (!plan) return { error: { field: 'plan', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (input.confirmedAt !== undefined && input.confirmedAt !== null && !confirmedAt) {
        return { error: { field: 'confirmedAt', type: 'invalid-value' }, ok: false };
    }
    if (input.appliedAt !== undefined && input.appliedAt !== null && !appliedAt) {
        return { error: { field: 'appliedAt', type: 'invalid-value' }, ok: false };
    }

    const createdByUserId = normalizeOptionalString(input.createdByUserId);
    const sourceSnapshotLegacyId = normalizeOptionalString(input.sourceSnapshotId);

    return {
        ok: true,
        value: {
            ...(appliedAt ? { appliedAt } : {}),
            ...(confirmedAt ? { confirmedAt } : {}),
            createdAt,
            ...(createdByUserId ? { createdByUserId } : {}),
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            plan,
            ...(sourceSnapshotLegacyId ? { sourceSnapshotLegacyId } : {}),
            status: normalizeOptionalString(input.status) ?? 'draft',
            updatedAt,
        },
    };
}

export function buildStructureImportRunStatusPatch(
    existing: Pick<StructureImportRunDocument, 'appliedAt' | 'confirmedAt' | 'plan' | 'status'>,
    input: { plan?: Record<string, unknown> | null; status?: string | null },
    now: string
): StructureInputResult<StructureImportRunStatusPatch> {
    const status = normalizeRequiredString(input.status, 'status');
    const plan = normalizeRecord(input.plan ?? existing.plan);

    if (!status.ok) return status;
    if (!plan) return { error: { field: 'plan', type: 'invalid-value' }, ok: false };

    const transition = assertAllowedStatusTransition(existing.status, status.value);
    if (!transition.ok) return transition;

    const appliedAt = status.value === 'applied' ? now : existing.appliedAt;
    const confirmedAt = status.value === 'confirmed' ? now : existing.confirmedAt;

    return {
        ok: true,
        value: {
            ...(appliedAt ? { appliedAt } : {}),
            ...(confirmedAt ? { confirmedAt } : {}),
            plan,
            status: status.value,
            updatedAt: now,
        },
    };
}

export function buildStructureImportActionDocument(
    input: StructureImportActionInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): StructureInputResult<StructureImportActionDocument> {
    const runId = normalizeRequiredString(input.runId, 'runId');
    const actionType = normalizeRequiredString(input.actionType, 'actionType');
    const targetType = normalizeRequiredString(input.targetType, 'targetType');
    const details = normalizeRecord(input.details ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!runId.ok) return runId;
    if (!actionType.ok) return actionType;
    if (!targetType.ok) return targetType;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const targetId = normalizeOptionalString(input.targetId);

    return {
        ok: true,
        value: {
            actionType: actionType.value,
            createdAt,
            details,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            runLegacyId: runId.value,
            status: normalizeOptionalString(input.status) ?? 'pending',
            ...(targetId ? { targetId } : {}),
            targetType: targetType.value,
            updatedAt,
        },
    };
}

export function buildObservedEventStateDocument(
    input: { eventType?: string | null; guildId?: string | null; targetId?: string | null; targetType?: string | null },
    existing: StructureObservedEventStateRecord,
    now: string,
    existingDocument?: Pick<StructureObservedEventStateDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): StructureInputResult<StructureObservedEventStateDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const eventType = normalizeRequiredString(input.eventType, 'eventType');
    const targetType = normalizeRequiredString(input.targetType, 'targetType');

    if (!guildId.ok) return guildId;
    if (!eventType.ok) return eventType;
    if (!targetType.ok) return targetType;

    const targetId = normalizeOptionalString(input.targetId);
    const config = {
        lastEventType: eventType.value,
        lastObservedAt: now,
        ...(targetId ? { lastTargetId: targetId } : {}),
        lastTargetType: targetType.value,
        observedChangeCount: existing.observedChangeCount + 1,
    };

    return {
        ok: true,
        value: {
            config,
            createdAt: existingDocument?.createdAt ?? now,
            enabled: true,
            feature: 'import_export',
            guildId: guildId.value,
            legacyId: existingDocument?.legacyId ?? createLegacyId(),
            updatedAt: now,
        },
    };
}

export function toStructureExportSnapshotRecord(
    document: StructureExportSnapshotDocument
): StructureExportSnapshotRecord {
    return {
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        guildId: document.guildId,
        id: document.legacyId,
        snapshot: document.snapshot,
        source: document.source,
    };
}

export function toStructureImportRunRecord(document: StructureImportRunDocument): StructureImportRunRecord {
    return {
        appliedAt: document.appliedAt ?? null,
        confirmedAt: document.confirmedAt ?? null,
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        guildId: document.guildId,
        id: document.legacyId,
        plan: document.plan,
        sourceSnapshotId: document.sourceSnapshotLegacyId ?? null,
        status: document.status,
        updatedAt: document.updatedAt,
    };
}

export function toStructureImportActionRecord(document: StructureImportActionDocument): StructureImportActionRecord {
    return {
        actionType: document.actionType,
        createdAt: document.createdAt,
        details: document.details,
        id: document.legacyId,
        runId: document.runLegacyId,
        status: document.status,
        targetId: document.targetId ?? null,
        targetType: document.targetType,
        updatedAt: document.updatedAt,
    };
}

export function toStructureObservedEventStateRecord(input: {
    config?: unknown;
    createdAt?: string;
    guildId: string;
    updatedAt?: string;
}): StructureObservedEventStateRecord {
    const config = normalizeRecord(input.config) ?? {};
    const lastEventType = readStringField(config, 'lastEventType');
    const lastObservedAt = readTimestampField(config, 'lastObservedAt');
    const lastTargetId = readStringField(config, 'lastTargetId');
    const lastTargetType = readStringField(config, 'lastTargetType');

    return {
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        guildId: input.guildId,
        ...(lastEventType ? { lastEventType } : {}),
        ...(lastObservedAt ? { lastObservedAt } : {}),
        ...(lastTargetId ? { lastTargetId } : {}),
        ...(lastTargetType ? { lastTargetType } : {}),
        observedChangeCount: readNonNegativeInteger(config.observedChangeCount),
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    };
}

export function normalizeRequiredGuildId(value: string): StructureInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeLimit(limit: number | undefined, fallback = 20): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;
    return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function assertAllowedStatusTransition(from: string, to: string): StructureInputResult<undefined> {
    if (from === to || importRunStatusTransitions.get(from)?.includes(to)) return { ok: true, value: undefined };
    return { error: { from, to, type: 'invalid-status-transition' }, ok: false };
}

function normalizeRequiredString(value: string | null | undefined, field: string): StructureInputResult<string> {
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
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function readNonNegativeInteger(value: unknown): number {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

function readStringField(config: Record<string, unknown>, field: string): string | undefined {
    const value = config[field];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readTimestampField(config: Record<string, unknown>, field: string): string | undefined {
    const value = config[field];
    return typeof value === 'string' ? normalizeTimestamp(value) : undefined;
}
