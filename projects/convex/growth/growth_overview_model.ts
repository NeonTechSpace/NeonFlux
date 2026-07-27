export type GuildMemberFlowEventType = 'join' | 'leave';

export type GuildMemberFlowEventDocument = {
    eventType: GuildMemberFlowEventType;
    guildId: string;
    membershipStartedAt?: string;
    occurredAt: string;
    userId: string;
};

export type GuildOverviewAggregate = {
    oldestRetainedActivityAt?: string;
    windowDays: number;
    activityPresence: {
        hasMemberFlow: boolean;
        hasMessageActivity: boolean;
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
};

export type GrowthInputError = { field: string; type: 'invalid-value' | 'missing-input' };
export type GrowthInputResult<Value> = { ok: true; value: Value } | { error: GrowthInputError; ok: false };

export function buildGuildMemberFlowEventDocument(
    input: {
        eventType?: string | null;
        guildId?: string | null;
        membershipStartedAt?: string | null;
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

    const membershipStartedAt =
        input.membershipStartedAt === undefined || input.membershipStartedAt === null
            ? undefined
            : normalizeTimestamp(input.membershipStartedAt);

    if (input.membershipStartedAt !== undefined && input.membershipStartedAt !== null && !membershipStartedAt) {
        return { error: { field: 'membershipStartedAt', type: 'invalid-value' }, ok: false };
    }
    if (eventType.value === 'join' && !membershipStartedAt) {
        return { error: { field: 'membershipStartedAt', type: 'missing-input' }, ok: false };
    }
    if (eventType.value === 'leave' && membershipStartedAt) {
        return { error: { field: 'membershipStartedAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            eventType: eventType.value,
            guildId: guildId.value,
            ...(membershipStartedAt === undefined ? {} : { membershipStartedAt }),
            occurredAt,
            userId: userId.value,
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
        membershipStartedAt: document.membershipStartedAt ?? null,
    };
}

function normalizeMemberFlowEventType(value: string | null | undefined): GrowthInputResult<GuildMemberFlowEventType> {
    const normalizedValue = value?.trim();

    if (normalizedValue === 'join' || normalizedValue === 'leave') return { ok: true, value: normalizedValue };

    return { error: { field: 'eventType', type: normalizedValue ? 'invalid-value' : 'missing-input' }, ok: false };
}

function normalizeRequiredString(value: string | null | undefined, field: string): GrowthInputResult<string> {
    const normalizedValue = value?.trim();

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
