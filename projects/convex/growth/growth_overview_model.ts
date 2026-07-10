export const maxCurrentInviteSnapshots = 1_000;

export type GuildMemberFlowEventType = 'join' | 'leave';
export type GuildInviteAttributionStatus =
    | 'ambiguous'
    | 'attributed'
    | 'baseline-missing'
    | 'not-applicable'
    | 'unavailable';

export type GuildMemberFlowEventDocument = {
    attributionStatus: GuildInviteAttributionStatus;
    eventType: GuildMemberFlowEventType;
    guildId: string;
    inviteCode?: string;
    inviterUserId?: string;
    occurredAt: string;
    userId: string;
};

export type GuildInviteSnapshotDocument = {
    active: boolean;
    channelId?: string;
    code: string;
    expiresAt?: string;
    firstSeenAt: string;
    guildId: string;
    inviterUserId?: string;
    lastSeenAt: string;
    maxUses?: number;
    revokedAt?: string;
    temporary: boolean;
    uses: number;
};

export type GuildInviteSnapshotInput = {
    channelId?: string | null;
    code?: string | null;
    expiresAt?: string | null;
    maxUses?: number | null;
    temporary?: boolean | null;
    uses?: number | null;
    inviterUserId?: string | null;
};

export type GuildOverviewAggregate = {
    dataHealth: {
        hasInviteSnapshots: boolean;
        hasMemberFlow: boolean;
        hasMessageActivity: boolean;
    };
    invites: {
        activeInviteCount: number;
        attribution: Record<GuildInviteAttributionStatus, number>;
        totalInviteUses: number;
    };
    memberFlow: {
        graph: Array<{ date: string; joins: number; leaves: number; netGrowth: number }>;
        netGrowth: number;
        totalJoins: number;
        totalLeaves: number;
    };
    messages: {
        graph: Array<{ date: string; messageCount: number }>;
        totalMessages: number;
    };
    trackingStartedAt?: string;
};

export type GrowthInputError = { field: string; type: 'invalid-value' | 'missing-input' };
export type GrowthInputResult<Value> = { ok: true; value: Value } | { error: GrowthInputError; ok: false };

export function buildGuildMemberFlowEventDocument(
    input: {
        attributionStatus?: string | null;
        eventType?: string | null;
        guildId?: string | null;
        inviteCode?: string | null;
        inviterUserId?: string | null;
        occurredAt?: string | null;
        userId?: string | null;
    },
    now: string
): GrowthInputResult<GuildMemberFlowEventDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const eventType = normalizeMemberFlowEventType(input.eventType);
    const occurredAt = input.occurredAt === undefined ? now : normalizeTimestamp(input.occurredAt);

    if (!guildId.ok) return guildId;
    if (!userId.ok) return userId;
    if (!eventType.ok) return eventType;
    if (!occurredAt) return { error: { field: 'occurredAt', type: 'invalid-value' }, ok: false };

    const inviteCode = normalizeOptionalString(input.inviteCode);
    const inviterUserId = normalizeOptionalString(input.inviterUserId);
    const attributionStatus = normalizeAttributionStatus(
        input.attributionStatus ?? (eventType.value === 'leave' ? 'not-applicable' : 'unavailable')
    );

    if (!attributionStatus.ok) return attributionStatus;

    return {
        ok: true,
        value: {
            attributionStatus: attributionStatus.value,
            eventType: eventType.value,
            guildId: guildId.value,
            ...(inviteCode === undefined ? {} : { inviteCode }),
            ...(inviterUserId === undefined ? {} : { inviterUserId }),
            occurredAt,
            userId: userId.value,
        },
    };
}

export function buildGuildInviteSnapshotDocument(
    guildId: string,
    input: GuildInviteSnapshotInput,
    observedAt: string,
    existing?: Pick<GuildInviteSnapshotDocument, 'firstSeenAt'>
): GrowthInputResult<GuildInviteSnapshotDocument> {
    const code = normalizeRequiredString(input.code, 'code');
    const uses = normalizeNonNegativeInteger(input.uses ?? 0, 'uses');
    const maxUses =
        input.maxUses === undefined || input.maxUses === null
            ? ({ ok: true, value: undefined } as GrowthInputResult<number | undefined>)
            : normalizeNonNegativeInteger(input.maxUses, 'maxUses');
    const expiresAt =
        input.expiresAt === undefined || input.expiresAt === null ? undefined : normalizeTimestamp(input.expiresAt);

    if (!code.ok) return code;
    if (!uses.ok) return uses;
    if (!maxUses.ok) return maxUses;
    if (input.expiresAt !== undefined && input.expiresAt !== null && !expiresAt) {
        return { error: { field: 'expiresAt', type: 'invalid-value' }, ok: false };
    }

    const channelId = normalizeOptionalString(input.channelId);
    const inviterUserId = normalizeOptionalString(input.inviterUserId);

    return {
        ok: true,
        value: {
            active: true,
            ...(channelId === undefined ? {} : { channelId }),
            code: code.value,
            ...(expiresAt === undefined ? {} : { expiresAt }),
            firstSeenAt: existing?.firstSeenAt ?? observedAt,
            guildId,
            ...(inviterUserId === undefined ? {} : { inviterUserId }),
            lastSeenAt: observedAt,
            ...(maxUses.value === undefined ? {} : { maxUses: maxUses.value }),
            temporary: input.temporary ?? false,
            uses: uses.value,
        },
    };
}

export function normalizeOverviewDays(days: number | undefined): GrowthInputResult<number> {
    if (days === undefined) return { ok: true, value: 30 };

    return Number.isInteger(days) && days >= 1 && days <= 90
        ? { ok: true, value: days }
        : { error: { field: 'days', type: 'invalid-value' }, ok: false };
}

export function normalizeObservedAt(value: string | undefined): GrowthInputResult<string> {
    if (value === undefined) return { ok: true, value: new Date().toISOString() };

    const normalizedValue = normalizeTimestamp(value);

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field: 'observedAt', type: 'invalid-value' }, ok: false };
}

export const normalizeRequiredGuildId = (value: string) => normalizeRequiredString(value, 'guildId');

export function toGuildMemberFlowEventRecord(document: GuildMemberFlowEventDocument & { _id: string }) {
    return {
        ...document,
        id: document._id,
        inviteCode: document.inviteCode ?? null,
        inviterUserId: document.inviterUserId ?? null,
    };
}

export function toGuildInviteSnapshotRecord(document: GuildInviteSnapshotDocument & { _id: string }) {
    return {
        ...document,
        channelId: document.channelId ?? null,
        expiresAt: document.expiresAt ?? null,
        id: document._id,
        inviterUserId: document.inviterUserId ?? null,
        maxUses: document.maxUses ?? null,
        revokedAt: document.revokedAt ?? null,
    };
}

function normalizeMemberFlowEventType(value: string | null | undefined): GrowthInputResult<GuildMemberFlowEventType> {
    const normalizedValue = value?.trim();

    if (normalizedValue === 'join' || normalizedValue === 'leave') return { ok: true, value: normalizedValue };

    return { error: { field: 'eventType', type: normalizedValue ? 'invalid-value' : 'missing-input' }, ok: false };
}

function normalizeAttributionStatus(value: string | null | undefined): GrowthInputResult<GuildInviteAttributionStatus> {
    const normalizedValue = value?.trim();

    if (
        normalizedValue === 'ambiguous' ||
        normalizedValue === 'attributed' ||
        normalizedValue === 'baseline-missing' ||
        normalizedValue === 'not-applicable' ||
        normalizedValue === 'unavailable'
    ) {
        return { ok: true, value: normalizedValue };
    }

    return { error: { field: 'attributionStatus', type: 'invalid-value' }, ok: false };
}

function normalizeRequiredString(value: string | null | undefined, field: string): GrowthInputResult<string> {
    const normalizedValue = value?.trim();

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

function normalizeNonNegativeInteger(value: number | null | undefined, field: string): GrowthInputResult<number> {
    return Number.isInteger(value) && Number(value) >= 0
        ? { ok: true, value: Number(value) }
        : { error: { field, type: 'invalid-value' }, ok: false };
}
