export type AutoroleRuleInput = {
    createdAt?: string | null;
    enabled?: boolean | null;
    guildId?: string | null;
    name?: string | null;
    roleId?: string | null;
    updatedAt?: string | null;
};

export type AutoroleRuleDocument = {
    createdAt: string;
    enabled: boolean;
    guildId: string;
    name?: string;
    roleId: string;
    updatedAt: string;
};

export type AutoroleRuleRecord = {
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string | null;
    roleId: string;
    updatedAt: string;
};

export type AutoroleInputError =
    | { field: 'createdAt' | 'updatedAt'; type: 'invalid-value' }
    | { field: 'guildId' | 'roleId'; type: 'missing-input' };

export type AutoroleInputResult<Value, ErrorValue> = { ok: true; value: Value } | { error: ErrorValue; ok: false };

export function buildAutoroleRuleDocument(
    input: AutoroleRuleInput,
    now: string,
    existing?: Pick<AutoroleRuleDocument, 'createdAt'>
): AutoroleInputResult<AutoroleRuleDocument, AutoroleInputError> {
    const lookup = normalizeAutoroleRuleLookupInput(input);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!lookup.ok) {
        return lookup;
    }

    if (!createdAt) {
        return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    }

    if (!updatedAt) {
        return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    }

    const name = normalizeOptionalString(input.name);

    return {
        ok: true,
        value: {
            ...lookup.value,
            createdAt,
            enabled: input.enabled ?? true,
            ...(name ? { name } : {}),
            updatedAt,
        },
    };
}

export function normalizeAutoroleRuleLookupInput(input: {
    guildId?: string | null;
    roleId?: string | null;
}): AutoroleInputResult<
    { guildId: string; roleId: string },
    Extract<AutoroleInputError, { field: 'guildId' | 'roleId' }>
> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const roleId = normalizeRequiredString(input.roleId, 'roleId');

    if (!guildId.ok) {
        return guildId;
    }

    if (!roleId.ok) {
        return roleId;
    }

    return {
        ok: true,
        value: {
            guildId: guildId.value,
            roleId: roleId.value,
        },
    };
}

export function normalizeRequiredGuildId(
    value: string
): AutoroleInputResult<string, Extract<AutoroleInputError, { field: 'guildId' }>> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeAutoroleRuleLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return 500;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 1000);
}

export function toAutoroleRuleRecord(document: AutoroleRuleDocument & { _id: string }): AutoroleRuleRecord {
    return {
        createdAt: document.createdAt,
        enabled: document.enabled,
        guildId: document.guildId,
        id: document._id,
        name: document.name ?? null,
        roleId: document.roleId,
        updatedAt: document.updatedAt,
    };
}

function normalizeRequiredString(
    value: string | null | undefined,
    field: 'guildId'
): AutoroleInputResult<string, Extract<AutoroleInputError, { field: 'guildId' }>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'roleId'
): AutoroleInputResult<string, Extract<AutoroleInputError, { field: 'roleId' }>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'guildId' | 'roleId'
): AutoroleInputResult<string, Extract<AutoroleInputError, { field: 'guildId' | 'roleId' }>> {
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

    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return new Date(parsed).toISOString();
}
