export type CommandPermissionRuleTargetType = 'category' | 'command';

export type CommandPermissionRuleInput = {
    createdAt?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    roleIds?: readonly string[];
    targetId?: string | null;
    targetType?: string | null;
    updatedAt?: string | null;
    userIds?: readonly string[];
};

export type CommandPermissionRuleDocument = {
    createdAt: string;
    guildId: string;
    legacyId: string;
    roleIds: string[];
    targetId: string;
    targetType: CommandPermissionRuleTargetType;
    updatedAt: string;
    userIds: string[];
};

export type CommandPermissionRuleRecord = {
    createdAt: string;
    guildId: string;
    id: string;
    roleIds: string[];
    targetId: string;
    targetType: CommandPermissionRuleTargetType;
    updatedAt: string;
    userIds: string[];
};

export type DashboardPermissionRuleInput = {
    createdAt?: string | null;
    guildId?: string | null;
    roleIds?: readonly string[];
    updatedAt?: string | null;
    userIds?: readonly string[];
};

export type DashboardPermissionRuleDocument = {
    createdAt: string;
    guildId: string;
    roleIds: string[];
    updatedAt: string;
    userIds: string[];
};

export type DashboardPermissionRuleRecord = DashboardPermissionRuleDocument;

export type AccessPermissionInputError =
    | 'invalid-created-at'
    | 'invalid-target-type'
    | 'invalid-updated-at'
    | 'missing-guild-id'
    | 'missing-target-id';

export type AccessPermissionInputResult<Value, ErrorValue extends string> =
    | { ok: true; value: Value }
    | { error: ErrorValue; ok: false };

export function buildCommandPermissionRuleDocument(
    input: CommandPermissionRuleInput,
    now: string,
    existing?: Pick<CommandPermissionRuleDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): AccessPermissionInputResult<CommandPermissionRuleDocument, AccessPermissionInputError> {
    const lookup = normalizeCommandPermissionLookupInput(input);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!lookup.ok) {
        return lookup;
    }

    if (!createdAt) {
        return { error: 'invalid-created-at', ok: false };
    }

    if (!updatedAt) {
        return { error: 'invalid-updated-at', ok: false };
    }

    return {
        ok: true,
        value: {
            ...lookup.value,
            createdAt,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            roleIds: normalizeIdList(input.roleIds),
            updatedAt,
            userIds: normalizeIdList(input.userIds),
        },
    };
}

export function buildDashboardPermissionRuleDocument(
    input: DashboardPermissionRuleInput,
    now: string,
    existing?: Pick<DashboardPermissionRuleDocument, 'createdAt'>
): AccessPermissionInputResult<DashboardPermissionRuleDocument, AccessPermissionInputError> {
    const guildId = normalizeRequiredString(input.guildId, 'missing-guild-id');
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) {
        return guildId;
    }

    if (!createdAt) {
        return { error: 'invalid-created-at', ok: false };
    }

    if (!updatedAt) {
        return { error: 'invalid-updated-at', ok: false };
    }

    return {
        ok: true,
        value: {
            createdAt,
            guildId: guildId.value,
            roleIds: normalizeIdList(input.roleIds),
            updatedAt,
            userIds: normalizeIdList(input.userIds),
        },
    };
}

export function normalizeCommandPermissionLookupInput(input: {
    guildId?: string | null;
    targetId?: string | null;
    targetType?: string | null;
}): AccessPermissionInputResult<
    { guildId: string; targetId: string; targetType: CommandPermissionRuleTargetType },
    'invalid-target-type' | 'missing-guild-id' | 'missing-target-id'
> {
    const guildId = normalizeRequiredString(input.guildId, 'missing-guild-id');
    const targetType = normalizeTargetType(input.targetType);
    const targetId = normalizeRequiredString(input.targetId, 'missing-target-id');

    if (!guildId.ok) {
        return guildId;
    }

    if (!targetType.ok) {
        return targetType;
    }

    if (!targetId.ok) {
        return targetId;
    }

    return {
        ok: true,
        value: {
            guildId: guildId.value,
            targetId: targetId.value,
            targetType: targetType.value,
        },
    };
}

export function normalizeRequiredGuildId(
    value: string
): AccessPermissionInputResult<string, Extract<AccessPermissionInputError, 'missing-guild-id'>> {
    return normalizeRequiredString(value, 'missing-guild-id');
}

export function normalizeGuildIds(values: readonly string[]): string[] {
    return normalizeIdList(values);
}

export function toCommandPermissionRuleRecord(document: CommandPermissionRuleDocument): CommandPermissionRuleRecord {
    return {
        createdAt: document.createdAt,
        guildId: document.guildId,
        id: document.legacyId,
        roleIds: normalizeIdList(document.roleIds),
        targetId: document.targetId,
        targetType: document.targetType,
        updatedAt: document.updatedAt,
        userIds: normalizeIdList(document.userIds),
    };
}

export function toDashboardPermissionRuleRecord(
    document: DashboardPermissionRuleDocument
): DashboardPermissionRuleRecord {
    return {
        createdAt: document.createdAt,
        guildId: document.guildId,
        roleIds: normalizeIdList(document.roleIds),
        updatedAt: document.updatedAt,
        userIds: normalizeIdList(document.userIds),
    };
}

function normalizeTargetType(
    value: string | null | undefined
): AccessPermissionInputResult<CommandPermissionRuleTargetType, 'invalid-target-type'> {
    const normalizedValue = normalizeOptionalString(value);

    if (normalizedValue === 'category' || normalizedValue === 'command') {
        return { ok: true, value: normalizedValue };
    }

    return { error: 'invalid-target-type', ok: false };
}

function normalizeRequiredString<ErrorValue extends AccessPermissionInputError>(
    value: string | null | undefined,
    missingError: ErrorValue
): AccessPermissionInputResult<string, ErrorValue> {
    const normalizedValue = normalizeOptionalString(value);

    return normalizedValue ? { ok: true, value: normalizedValue } : { error: missingError, ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeIdList(values: readonly string[] | undefined): string[] {
    return values?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return new Date(parsed).toISOString();
}
