import { buildGuildFeatureSettingDocument, type GuildFeatureSettingDocument } from '../core/feature_settings_model.js';

export const ROLE_RECONCILIATION_FEATURE = 'role_reconciliation';
export const DEFAULT_ROLE_RECONCILIATION_SETTINGS = {
    cleanupDeletedRoleReferences: true,
    enabled: true,
    restoreAutoroleRoles: true,
    restoreReactionRoles: true,
    restoreVerificationRoles: true,
} as const;

export type RoleReconciliationSettingsInput = {
    cleanupDeletedRoleReferences?: boolean | null;
    createdAt?: string | null;
    enabled?: boolean | null;
    guildId?: string | null;
    legacyId?: string | null;
    restoreAutoroleRoles?: boolean | null;
    restoreReactionRoles?: boolean | null;
    restoreVerificationRoles?: boolean | null;
    updatedAt?: string | null;
};

export type RoleReconciliationSettingsRecord = {
    cleanupDeletedRoleReferences: boolean;
    createdAt?: string;
    enabled: boolean;
    guildId: string;
    restoreAutoroleRoles: boolean;
    restoreReactionRoles: boolean;
    restoreVerificationRoles: boolean;
    updatedAt?: string;
};

export type RoleReconciliationRunInput = {
    createdAt?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    status?: string | null;
    summary?: Record<string, unknown> | null;
    updatedAt?: string | null;
};

export type RoleReconciliationRunDocument = {
    createdAt: string;
    guildId: string;
    legacyId: string;
    status: string;
    summary: Record<string, unknown>;
    updatedAt: string;
};

export type RoleReconciliationRunRecord = {
    createdAt: string;
    guildId: string;
    id: string;
    status: string;
    summary: Record<string, unknown>;
    updatedAt: string;
};

export type RoleReconciliationActionInput = {
    actionType?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    legacyId?: string | null;
    roleId?: string | null;
    runId?: string | null;
    status?: string | null;
    updatedAt?: string | null;
};

export type RoleReconciliationActionDocument = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    legacyId: string;
    roleId?: string;
    runLegacyId: string;
    status: string;
    updatedAt: string;
};

export type RoleReconciliationActionRecord = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    id: string;
    roleId: string | null;
    runId: string;
    status: string;
    updatedAt: string;
};

export type RoleReconciliationInputError =
    | { field: string; type: 'invalid-value' | 'missing-input' }
    | { from: string; to: string; type: 'invalid-status-transition' };

export type RoleReconciliationInputResult<Value> =
    | { ok: true; value: Value }
    | { error: RoleReconciliationInputError; ok: false };

const runStatusTransitions = new Map<string, readonly string[]>([
    ['pending', ['dry_run_complete', 'applying', 'cancelled', 'failed']],
    ['dry_run_complete', ['applying', 'cancelled']],
    ['applying', ['applied', 'failed']],
    ['applied', []],
    ['cancelled', []],
    ['failed', []],
]);

export function buildRoleReconciliationSettingsDocument(
    input: RoleReconciliationSettingsInput,
    now: string,
    existing?: Pick<GuildFeatureSettingDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): RoleReconciliationInputResult<GuildFeatureSettingDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');

    if (!guildId.ok) return guildId;

    const settingInput = {
        config: {
            cleanupDeletedRoleReferences:
                input.cleanupDeletedRoleReferences ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.cleanupDeletedRoleReferences,
            restoreAutoroleRoles:
                input.restoreAutoroleRoles ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreAutoroleRoles,
            restoreReactionRoles:
                input.restoreReactionRoles ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreReactionRoles,
            restoreVerificationRoles:
                input.restoreVerificationRoles ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreVerificationRoles,
        },
        enabled: input.enabled ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.enabled,
        feature: ROLE_RECONCILIATION_FEATURE,
        guildId: guildId.value,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
        ...(input.legacyId === undefined ? {} : { legacyId: input.legacyId }),
        ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    };
    const document = buildGuildFeatureSettingDocument(settingInput, now, existing, createLegacyId);

    if (!document.ok) {
        return {
            error: { field: document.error, type: 'invalid-value' },
            ok: false,
        };
    }

    return document;
}

export function defaultRoleReconciliationSettingsRecord(guildId: string): RoleReconciliationSettingsRecord {
    return {
        guildId,
        ...DEFAULT_ROLE_RECONCILIATION_SETTINGS,
    };
}

export function toRoleReconciliationSettingsRecord(
    document: GuildFeatureSettingDocument
): RoleReconciliationSettingsRecord {
    const config = document.config;

    return {
        cleanupDeletedRoleReferences: readBoolean(
            config.cleanupDeletedRoleReferences,
            DEFAULT_ROLE_RECONCILIATION_SETTINGS.cleanupDeletedRoleReferences
        ),
        createdAt: document.createdAt,
        enabled: document.enabled,
        guildId: document.guildId,
        restoreAutoroleRoles: readBoolean(
            config.restoreAutoroleRoles,
            DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreAutoroleRoles
        ),
        restoreReactionRoles: readBoolean(
            config.restoreReactionRoles,
            DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreReactionRoles
        ),
        restoreVerificationRoles: readBoolean(
            config.restoreVerificationRoles,
            DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreVerificationRoles
        ),
        updatedAt: document.updatedAt,
    };
}

export function buildRoleReconciliationRunDocument(
    input: RoleReconciliationRunInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): RoleReconciliationInputResult<RoleReconciliationRunDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const status = normalizeRequiredString(input.status ?? 'pending', 'status');
    const summary = normalizeRecord(input.summary ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!status.ok) return status;
    if (!summary) return { error: { field: 'summary', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            createdAt,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            status: status.value,
            summary,
            updatedAt,
        },
    };
}

export function buildRoleReconciliationRunStatusPatch(
    existing: Pick<RoleReconciliationRunDocument, 'status' | 'summary'>,
    input: { status?: string | null; summary?: Record<string, unknown> | null; updatedAt?: string | null },
    now: string
): RoleReconciliationInputResult<Pick<RoleReconciliationRunDocument, 'status' | 'summary' | 'updatedAt'>> {
    const status = normalizeRequiredString(input.status, 'status');
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const summary = input.summary === undefined ? existing.summary : normalizeRecord(input.summary);

    if (!status.ok) return status;
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (!summary) return { error: { field: 'summary', type: 'invalid-value' }, ok: false };

    const transition = assertAllowedStatusTransition(existing.status, status.value);

    if (!transition.ok) return transition;

    return {
        ok: true,
        value: {
            status: status.value,
            summary,
            updatedAt,
        },
    };
}

export function buildRoleReconciliationActionDocument(
    input: RoleReconciliationActionInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): RoleReconciliationInputResult<RoleReconciliationActionDocument> {
    const runId = normalizeRequiredString(input.runId, 'runId');
    const actionType = normalizeRequiredString(input.actionType, 'actionType');
    const status = normalizeRequiredString(input.status ?? 'pending', 'status');
    const details = normalizeRecord(input.details ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!runId.ok) return runId;
    if (!actionType.ok) return actionType;
    if (!status.ok) return status;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const roleId = normalizeOptionalString(input.roleId);

    return {
        ok: true,
        value: {
            actionType: actionType.value,
            createdAt,
            details,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            ...(roleId ? { roleId } : {}),
            runLegacyId: runId.value,
            status: status.value,
            updatedAt,
        },
    };
}

export function normalizeRequiredGuildId(value: string): RoleReconciliationInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredRunId(value: string): RoleReconciliationInputResult<string> {
    return normalizeRequiredString(value, 'runId');
}

export function toRoleReconciliationRunRecord(document: RoleReconciliationRunDocument): RoleReconciliationRunRecord {
    return {
        createdAt: document.createdAt,
        guildId: document.guildId,
        id: document.legacyId,
        status: document.status,
        summary: document.summary,
        updatedAt: document.updatedAt,
    };
}

export function toRoleReconciliationActionRecord(
    document: RoleReconciliationActionDocument
): RoleReconciliationActionRecord {
    return {
        actionType: document.actionType,
        createdAt: document.createdAt,
        details: document.details,
        id: document.legacyId,
        roleId: document.roleId ?? null,
        runId: document.runLegacyId,
        status: document.status,
        updatedAt: document.updatedAt,
    };
}

function assertAllowedStatusTransition(from: string, to: string): RoleReconciliationInputResult<undefined> {
    if (from === to || runStatusTransitions.get(from)?.includes(to)) {
        return { ok: true, value: undefined };
    }

    return {
        error: {
            from,
            to,
            type: 'invalid-status-transition',
        },
        ok: false,
    };
}

function normalizeRequiredString(
    value: string | null | undefined,
    field: string
): RoleReconciliationInputResult<string> {
    const normalizedValue = normalizeOptionalString(value);

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
    return isPlainRecord(value) ? value : undefined;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
