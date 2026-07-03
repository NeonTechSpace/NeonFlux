export type GuildDefconLevel = 1 | 2 | 3;

export type GuildSecurityPolicyInput = {
    createdAt?: string | null;
    defconLevel?: number | null;
    guildId?: string | null;
    updatedAt?: string | null;
};

export type GuildSecurityPolicyDocument = {
    createdAt: string;
    defconLevel: GuildDefconLevel;
    guildId: string;
    updatedAt: string;
};

export type GuildSecurityPolicyRecord = GuildSecurityPolicyDocument;

export type GuildDefconExemptionInput = {
    category?: string | null;
    createdAt?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
};

export type GuildDefconExemptionDocument = {
    category: string;
    createdAt: string;
    guildId: string;
    legacyId: string;
};

export type GuildDefconExemptionRecord = {
    category: string;
    createdAt: string;
    guildId: string;
};

export type SecurityPolicyInputError =
    | 'invalid-created-at'
    | 'invalid-defcon-level'
    | 'invalid-updated-at'
    | 'missing-category'
    | 'missing-guild-id';

export type SecurityPolicyInputResult<Value, ErrorValue extends string> =
    | { ok: true; value: Value }
    | { error: ErrorValue; ok: false };

export function buildGuildSecurityPolicyDocument(
    input: GuildSecurityPolicyInput,
    now: string,
    existing?: Pick<GuildSecurityPolicyDocument, 'createdAt'>
): SecurityPolicyInputResult<GuildSecurityPolicyDocument, SecurityPolicyInputError> {
    const guildId = normalizeRequiredString(input.guildId, 'missing-guild-id');
    const defconLevel = normalizeDefconLevel(input.defconLevel);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) {
        return guildId;
    }

    if (!defconLevel.ok) {
        return defconLevel;
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
            defconLevel: defconLevel.value,
            guildId: guildId.value,
            updatedAt,
        },
    };
}

export function buildGuildDefconExemptionDocument(
    input: GuildDefconExemptionInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): SecurityPolicyInputResult<
    GuildDefconExemptionDocument,
    Extract<SecurityPolicyInputError, 'invalid-created-at' | 'missing-category' | 'missing-guild-id'>
> {
    const lookup = normalizeDefconExemptionLookupInput(input);
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!lookup.ok) {
        return lookup;
    }

    if (!createdAt) {
        return { error: 'invalid-created-at', ok: false };
    }

    return {
        ok: true,
        value: {
            ...lookup.value,
            createdAt,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
        },
    };
}

export function normalizeDefconExemptionLookupInput(input: {
    category?: string | null;
    guildId?: string | null;
}): SecurityPolicyInputResult<
    { category: string; guildId: string },
    Extract<SecurityPolicyInputError, 'missing-category' | 'missing-guild-id'>
> {
    const guildId = normalizeRequiredString(input.guildId, 'missing-guild-id');
    const category = normalizeRequiredString(input.category, 'missing-category');

    if (!guildId.ok) {
        return guildId;
    }

    if (!category.ok) {
        return category;
    }

    return {
        ok: true,
        value: {
            category: category.value,
            guildId: guildId.value,
        },
    };
}

export function normalizeRequiredGuildId(
    value: string
): SecurityPolicyInputResult<string, Extract<SecurityPolicyInputError, 'missing-guild-id'>> {
    return normalizeRequiredString(value, 'missing-guild-id');
}

export function normalizeGuildIds(values: readonly string[]): string[] {
    return normalizeIdList(values);
}

export function toGuildSecurityPolicyRecord(document: GuildSecurityPolicyDocument): GuildSecurityPolicyRecord {
    return {
        createdAt: document.createdAt,
        defconLevel: document.defconLevel,
        guildId: document.guildId,
        updatedAt: document.updatedAt,
    };
}

export function toGuildDefconExemptionRecord(document: GuildDefconExemptionDocument): GuildDefconExemptionRecord {
    return {
        category: document.category,
        createdAt: document.createdAt,
        guildId: document.guildId,
    };
}

function normalizeDefconLevel(
    value: number | null | undefined
): SecurityPolicyInputResult<GuildDefconLevel, 'invalid-defcon-level'> {
    if (value === 1 || value === 2 || value === 3) {
        return { ok: true, value };
    }

    return { error: 'invalid-defcon-level', ok: false };
}

function normalizeRequiredString<ErrorValue extends SecurityPolicyInputError>(
    value: string | null | undefined,
    missingError: ErrorValue
): SecurityPolicyInputResult<string, ErrorValue> {
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
