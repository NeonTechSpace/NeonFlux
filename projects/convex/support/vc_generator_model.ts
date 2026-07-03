export type VcGeneratorRuleInput = {
    categoryId?: string | null;
    config?: Record<string, unknown> | null;
    createdAt?: string | null;
    enabled?: boolean | null;
    guildId?: string | null;
    legacyId?: string | null;
    nameTemplate?: string | null;
    sourceChannelId?: string | null;
    updatedAt?: string | null;
};

export type VcGeneratorRuleDocument = {
    categoryId?: string;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    legacyId: string;
    nameTemplate: string;
    sourceChannelId: string;
    updatedAt: string;
};

export type GeneratedVoiceChannelInput = {
    channelId?: string | null;
    createdAt?: string | null;
    guildId?: string | null;
    lastSeenAt?: string | null;
    legacyId?: string | null;
    ownerUserId?: string | null;
    ruleId?: string | null;
    status?: string | null;
    updatedAt?: string | null;
};

export type GeneratedVoiceChannelDocument = {
    channelId: string;
    createdAt: string;
    guildId: string;
    lastSeenAt: string;
    legacyId: string;
    ownerUserId?: string;
    ruleLegacyId?: string;
    status: string;
    updatedAt: string;
};

export type VcGeneratorControlPanelInput = {
    channelId?: string | null;
    config?: Record<string, unknown> | null;
    controlMode?: string | null;
    createdAt?: string | null;
    guildId?: string | null;
    lastSyncedAt?: string | null;
    legacyId?: string | null;
    messageId?: string | null;
    ruleId?: string | null;
    staleAt?: string | null;
    status?: string | null;
    synced?: boolean | null;
    updatedAt?: string | null;
};

export type VcGeneratorControlPanelDocument = {
    channelId: string;
    config: Record<string, unknown>;
    controlMode: string;
    createdAt: string;
    guildId: string;
    lastSyncedAt?: string;
    legacyId: string;
    messageId?: string;
    ruleLegacyId: string;
    staleAt?: string;
    status: string;
    updatedAt: string;
};

export type VcGeneratorControlRequestInput = {
    completedAt?: string | null;
    controlAction?: string | null;
    createdAt?: string | null;
    errorMessage?: string | null;
    expiresAt?: string | null;
    generatedChannelId?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    panelChannelId?: string | null;
    promptMessageId?: string | null;
    requesterUserId?: string | null;
    status?: string | null;
    targetChannelId?: string | null;
    updatedAt?: string | null;
    value?: string | null;
};

export type VcGeneratorControlRequestDocument = {
    completedAt?: string;
    controlAction: string;
    createdAt: string;
    errorMessage?: string;
    expiresAt: string;
    generatedChannelLegacyId: string;
    guildId: string;
    legacyId: string;
    panelChannelId: string;
    promptMessageId?: string;
    requesterUserId: string;
    status: string;
    targetChannelId: string;
    updatedAt: string;
    value?: string;
};

export type VcGeneratorRuleRecord = {
    categoryId: string | null;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    nameTemplate: string;
    sourceChannelId: string;
    updatedAt: string;
};
export type GeneratedVoiceChannelRecord = {
    channelId: string;
    createdAt: string;
    guildId: string;
    id: string;
    lastSeenAt: string;
    ownerUserId: string | null;
    ruleId: string | null;
    status: string;
    updatedAt: string;
};
export type VcGeneratorControlPanelRecord = {
    channelId: string;
    config: Record<string, unknown>;
    controlMode: string;
    createdAt: string;
    guildId: string;
    id: string;
    lastSyncedAt: string | null;
    messageId: string | null;
    ruleId: string;
    staleAt: string | null;
    status: string;
    updatedAt: string;
};
export type VcGeneratorControlRequestRecord = {
    completedAt: string | null;
    controlAction: string;
    createdAt: string;
    errorMessage: string | null;
    expiresAt: string;
    generatedChannelId: string;
    guildId: string;
    id: string;
    panelChannelId: string;
    promptMessageId: string | null;
    requesterUserId: string;
    status: string;
    targetChannelId: string;
    updatedAt: string;
    value: string | null;
};

export type GeneratedVoiceChannelStatus = 'active' | 'deleted' | 'orphaned';
export type VcGeneratorControlPanelStatus = 'active' | 'stale' | 'disabled';
export type VcGeneratorControlMode = 'reaction';
export type VcGeneratorControlAction = 'rename' | 'user_limit' | 'whitelist' | 'blacklist' | 'lock' | 'unlock';
export type VcGeneratorControlRequestStatus = 'pending' | 'applied' | 'failed' | 'cancelled' | 'expired';
export type VcGeneratorInputError = { field: string; type: 'invalid-value' | 'missing-input' };
export type VcGeneratorInputResult<Value> = { ok: true; value: Value } | { error: VcGeneratorInputError; ok: false };

const generatedVoiceChannelStatuses = new Set<GeneratedVoiceChannelStatus>(['active', 'deleted', 'orphaned']);
const controlPanelStatuses = new Set<VcGeneratorControlPanelStatus>(['active', 'stale', 'disabled']);
const controlRequestActions = new Set<VcGeneratorControlAction>([
    'rename',
    'user_limit',
    'whitelist',
    'blacklist',
    'lock',
    'unlock',
]);
const controlRequestStatuses = new Set<VcGeneratorControlRequestStatus>([
    'pending',
    'applied',
    'failed',
    'cancelled',
    'expired',
]);

export function buildVcGeneratorRuleDocument(
    input: VcGeneratorRuleInput,
    now: string,
    existing?: Pick<VcGeneratorRuleDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): VcGeneratorInputResult<VcGeneratorRuleDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const sourceChannelId = normalizeRequiredString(input.sourceChannelId, 'sourceChannelId');
    const nameTemplate = normalizeRequiredString(input.nameTemplate, 'nameTemplate');
    const config = normalizeRecord(input.config ?? {});
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!sourceChannelId.ok) return sourceChannelId;
    if (!nameTemplate.ok) return nameTemplate;
    if (!config) return { error: { field: 'config', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const categoryId = normalizeOptionalString(input.categoryId);

    return {
        ok: true,
        value: {
            ...(categoryId ? { categoryId } : {}),
            config,
            createdAt,
            enabled: input.enabled ?? true,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            nameTemplate: nameTemplate.value,
            sourceChannelId: sourceChannelId.value,
            updatedAt,
        },
    };
}

export function buildGeneratedVoiceChannelDocument(
    input: GeneratedVoiceChannelInput,
    now: string,
    existing?: Pick<GeneratedVoiceChannelDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): VcGeneratorInputResult<GeneratedVoiceChannelDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const status = normalizeGeneratedVoiceChannelStatus(input.status ?? 'active');
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const lastSeenAt = input.lastSeenAt === undefined ? updatedAt : normalizeTimestamp(input.lastSeenAt);

    if (!guildId.ok) return guildId;
    if (!channelId.ok) return channelId;
    if (!status.ok) return status;
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (!lastSeenAt) return { error: { field: 'lastSeenAt', type: 'invalid-value' }, ok: false };

    const ownerUserId = normalizeOptionalString(input.ownerUserId);
    const ruleLegacyId = normalizeOptionalString(input.ruleId);

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            createdAt,
            guildId: guildId.value,
            lastSeenAt,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            ...(ownerUserId ? { ownerUserId } : {}),
            ...(ruleLegacyId ? { ruleLegacyId } : {}),
            status: status.value,
            updatedAt,
        },
    };
}

export function buildVcGeneratorControlPanelDocument(
    input: VcGeneratorControlPanelInput,
    now: string,
    existing?: Pick<VcGeneratorControlPanelDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): VcGeneratorInputResult<VcGeneratorControlPanelDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const ruleId = normalizeRequiredString(input.ruleId, 'ruleId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const status = normalizeControlPanelStatus(input.status ?? 'active');
    const controlMode = normalizeControlMode(input.controlMode ?? 'reaction');
    const config = normalizeRecord(input.config ?? {});
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!ruleId.ok) return ruleId;
    if (!channelId.ok) return channelId;
    if (!status.ok) return status;
    if (!controlMode.ok) return controlMode;
    if (!config) return { error: { field: 'config', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const messageId = normalizeOptionalString(input.messageId);
    const syncedAt = input.lastSyncedAt === undefined ? undefined : normalizeTimestamp(input.lastSyncedAt);
    const staleAt =
        input.staleAt === undefined
            ? status.value === 'stale'
                ? updatedAt
                : undefined
            : normalizeTimestamp(input.staleAt);

    if (input.lastSyncedAt !== undefined && input.lastSyncedAt !== null && !syncedAt) {
        return { error: { field: 'lastSyncedAt', type: 'invalid-value' }, ok: false };
    }
    if (input.staleAt !== undefined && input.staleAt !== null && !staleAt) {
        return { error: { field: 'staleAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            config,
            controlMode: controlMode.value,
            createdAt,
            guildId: guildId.value,
            ...(input.synced ? { lastSyncedAt: updatedAt } : syncedAt ? { lastSyncedAt: syncedAt } : {}),
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            ...(messageId ? { messageId } : {}),
            ruleLegacyId: ruleId.value,
            ...(staleAt ? { staleAt } : {}),
            status: status.value,
            updatedAt,
        },
    };
}

export function buildVcGeneratorControlRequestDocument(
    input: VcGeneratorControlRequestInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): VcGeneratorInputResult<VcGeneratorControlRequestDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const generatedChannelId = normalizeRequiredString(input.generatedChannelId, 'generatedChannelId');
    const panelChannelId = normalizeRequiredString(input.panelChannelId, 'panelChannelId');
    const targetChannelId = normalizeRequiredString(input.targetChannelId, 'targetChannelId');
    const requesterUserId = normalizeRequiredString(input.requesterUserId, 'requesterUserId');
    const action = normalizeControlRequestAction(input.controlAction);
    const status = normalizeControlRequestStatus(input.status ?? 'pending');
    const expiresAt = normalizeTimestamp(input.expiresAt);
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!generatedChannelId.ok) return generatedChannelId;
    if (!panelChannelId.ok) return panelChannelId;
    if (!targetChannelId.ok) return targetChannelId;
    if (!requesterUserId.ok) return requesterUserId;
    if (!action.ok) return action;
    if (!status.ok) return status;
    if (!expiresAt) return { error: { field: 'expiresAt', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const completedAt = input.completedAt === undefined ? undefined : normalizeTimestamp(input.completedAt);
    if (input.completedAt !== undefined && input.completedAt !== null && !completedAt) {
        return { error: { field: 'completedAt', type: 'invalid-value' }, ok: false };
    }

    const errorMessage = normalizeOptionalString(input.errorMessage);
    const promptMessageId = normalizeOptionalString(input.promptMessageId);
    const value = normalizeOptionalString(input.value);

    return {
        ok: true,
        value: {
            ...(completedAt ? { completedAt } : {}),
            controlAction: action.value,
            createdAt,
            ...(errorMessage ? { errorMessage } : {}),
            expiresAt,
            generatedChannelLegacyId: generatedChannelId.value,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            panelChannelId: panelChannelId.value,
            ...(promptMessageId ? { promptMessageId } : {}),
            requesterUserId: requesterUserId.value,
            status: status.value,
            targetChannelId: targetChannelId.value,
            updatedAt,
            ...(value ? { value } : {}),
        },
    };
}

export function normalizeRequiredGuildId(value: string): VcGeneratorInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredLimit(limit: number | undefined, fallback = 100): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;
    return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

export function toVcGeneratorRuleRecord(document: VcGeneratorRuleDocument): VcGeneratorRuleRecord {
    return { ...document, categoryId: document.categoryId ?? null, id: document.legacyId };
}

export function toGeneratedVoiceChannelRecord(document: GeneratedVoiceChannelDocument): GeneratedVoiceChannelRecord {
    return {
        channelId: document.channelId,
        createdAt: document.createdAt,
        guildId: document.guildId,
        id: document.legacyId,
        lastSeenAt: document.lastSeenAt,
        ownerUserId: document.ownerUserId ?? null,
        ruleId: document.ruleLegacyId ?? null,
        status: document.status,
        updatedAt: document.updatedAt,
    };
}

export function toVcGeneratorControlPanelRecord(
    document: VcGeneratorControlPanelDocument
): VcGeneratorControlPanelRecord {
    return {
        channelId: document.channelId,
        config: document.config,
        controlMode: document.controlMode,
        createdAt: document.createdAt,
        guildId: document.guildId,
        id: document.legacyId,
        lastSyncedAt: document.lastSyncedAt ?? null,
        messageId: document.messageId ?? null,
        ruleId: document.ruleLegacyId,
        staleAt: document.staleAt ?? null,
        status: document.status,
        updatedAt: document.updatedAt,
    };
}

export function toVcGeneratorControlRequestRecord(
    document: VcGeneratorControlRequestDocument
): VcGeneratorControlRequestRecord {
    return {
        completedAt: document.completedAt ?? null,
        controlAction: document.controlAction,
        createdAt: document.createdAt,
        errorMessage: document.errorMessage ?? null,
        expiresAt: document.expiresAt,
        generatedChannelId: document.generatedChannelLegacyId,
        guildId: document.guildId,
        id: document.legacyId,
        panelChannelId: document.panelChannelId,
        promptMessageId: document.promptMessageId ?? null,
        requesterUserId: document.requesterUserId,
        status: document.status,
        targetChannelId: document.targetChannelId,
        updatedAt: document.updatedAt,
        value: document.value ?? null,
    };
}

function normalizeRequiredString(value: string | null | undefined, field: string): VcGeneratorInputResult<string> {
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

function normalizeRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function normalizeGeneratedVoiceChannelStatus(
    value: string | null | undefined
): VcGeneratorInputResult<GeneratedVoiceChannelStatus> {
    return generatedVoiceChannelStatuses.has(value as GeneratedVoiceChannelStatus)
        ? { ok: true, value: value as GeneratedVoiceChannelStatus }
        : { error: { field: 'status', type: 'invalid-value' }, ok: false };
}

function normalizeControlPanelStatus(
    value: string | null | undefined
): VcGeneratorInputResult<VcGeneratorControlPanelStatus> {
    return controlPanelStatuses.has(value as VcGeneratorControlPanelStatus)
        ? { ok: true, value: value as VcGeneratorControlPanelStatus }
        : { error: { field: 'status', type: 'invalid-value' }, ok: false };
}

function normalizeControlMode(value: string | null | undefined): VcGeneratorInputResult<VcGeneratorControlMode> {
    return value === 'reaction'
        ? { ok: true, value }
        : { error: { field: 'controlMode', type: 'invalid-value' }, ok: false };
}

function normalizeControlRequestAction(
    value: string | null | undefined
): VcGeneratorInputResult<VcGeneratorControlAction> {
    return controlRequestActions.has(value as VcGeneratorControlAction)
        ? { ok: true, value: value as VcGeneratorControlAction }
        : { error: { field: 'controlAction', type: 'invalid-value' }, ok: false };
}

function normalizeControlRequestStatus(
    value: string | null | undefined
): VcGeneratorInputResult<VcGeneratorControlRequestStatus> {
    return controlRequestStatuses.has(value as VcGeneratorControlRequestStatus)
        ? { ok: true, value: value as VcGeneratorControlRequestStatus }
        : { error: { field: 'status', type: 'invalid-value' }, ok: false };
}
