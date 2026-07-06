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

export type GuildMessageActivityDayDocument = {
    activityDate: string;
    channelId: string;
    guildId: string;
    messageCount: number;
    updatedAt: string;
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
        topInviters: Array<{
            attributedJoins: number;
            inviteCodes: Array<{ active: boolean; code: string; uses: number }>;
            inviterUserId: string;
        }>;
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
        topChannels: Array<{ channelId: string; messageCount: number }>;
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

export function revokeGuildInviteSnapshotDocument(
    document: GuildInviteSnapshotDocument,
    observedAt: string
): GuildInviteSnapshotDocument {
    return {
        ...document,
        active: false,
        lastSeenAt: observedAt,
        revokedAt: observedAt,
    };
}

export function buildGuildMessageActivityDayDocument(
    input: {
        channelId?: string | null;
        guildId?: string | null;
        occurredAt?: string | null;
    },
    now: string,
    existing?: Pick<GuildMessageActivityDayDocument, 'messageCount'>
): GrowthInputResult<GuildMessageActivityDayDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const occurredAt = input.occurredAt === undefined ? now : normalizeTimestamp(input.occurredAt);

    if (!guildId.ok) return guildId;
    if (!channelId.ok) return channelId;
    if (!occurredAt) return { error: { field: 'occurredAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            activityDate: formatUtcDate(occurredAt),
            channelId: channelId.value,
            guildId: guildId.value,
            messageCount: (existing?.messageCount ?? 0) + 1,
            updatedAt: occurredAt,
        },
    };
}

export function toGuildOverviewAggregate(input: {
    days: number;
    inviteSnapshots: GuildInviteSnapshotDocument[];
    memberEvents: GuildMemberFlowEventDocument[];
    messageActivityDays: GuildMessageActivityDayDocument[];
    now: string;
}): GuildOverviewAggregate {
    const now = new Date(input.now);
    const memberFlowGraph = createMemberFlowGraph(input.memberEvents, input.days, now);
    const messageGraph = createMessageActivityGraph(input.messageActivityDays, input.days, now);
    const totalJoins = input.memberEvents.filter((event) => event.eventType === 'join').length;
    const totalLeaves = input.memberEvents.filter((event) => event.eventType === 'leave').length;
    const activeInviteSnapshots = input.inviteSnapshots.filter((invite) => invite.active);
    const trackingStartedAt = findTrackingStartedAt(
        input.memberEvents,
        input.inviteSnapshots,
        input.messageActivityDays
    );

    return {
        ...(trackingStartedAt === undefined ? {} : { trackingStartedAt }),
        dataHealth: {
            hasInviteSnapshots: input.inviteSnapshots.length > 0,
            hasMemberFlow: input.memberEvents.length > 0,
            hasMessageActivity: input.messageActivityDays.length > 0,
        },
        invites: {
            activeInviteCount: activeInviteSnapshots.length,
            attribution: createAttributionCounts(input.memberEvents),
            topInviters: createTopInviters(input.memberEvents, input.inviteSnapshots),
            totalInviteUses: activeInviteSnapshots.reduce((total, invite) => total + invite.uses, 0),
        },
        memberFlow: {
            graph: memberFlowGraph,
            netGrowth: totalJoins - totalLeaves,
            totalJoins,
            totalLeaves,
        },
        messages: {
            graph: messageGraph,
            topChannels: createTopChannels(input.messageActivityDays),
            totalMessages: input.messageActivityDays.reduce((total, day) => total + day.messageCount, 0),
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

export function toGuildMessageActivityDayRecord(document: GuildMessageActivityDayDocument & { _id: string }) {
    return { ...document, id: document._id };
}

function createMessageActivityGraph(
    messageActivityDays: GuildMessageActivityDayDocument[],
    days: number,
    now: Date
): GuildOverviewAggregate['messages']['graph'] {
    const messageCountsByDate = new Map<string, number>();

    for (const activityDay of messageActivityDays) {
        messageCountsByDate.set(
            activityDay.activityDate,
            (messageCountsByDate.get(activityDay.activityDate) ?? 0) + activityDay.messageCount
        );
    }

    return Array.from({ length: days }, (_, index) => {
        const offset = days - 1 - index;
        const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
        const date = formatUtcDate(day.toISOString());

        return { date, messageCount: messageCountsByDate.get(date) ?? 0 };
    });
}

function createMemberFlowGraph(
    memberEvents: GuildMemberFlowEventDocument[],
    days: number,
    now: Date
): GuildOverviewAggregate['memberFlow']['graph'] {
    return Array.from({ length: days }, (_, index) => {
        const offset = days - 1 - index;
        const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
        const date = formatUtcDate(day.toISOString());
        const dayEvents = memberEvents.filter((event) => formatUtcDate(event.occurredAt) === date);
        const joins = dayEvents.filter((event) => event.eventType === 'join').length;
        const leaves = dayEvents.filter((event) => event.eventType === 'leave').length;

        return { date, joins, leaves, netGrowth: joins - leaves };
    });
}

function createAttributionCounts(
    memberEvents: GuildMemberFlowEventDocument[]
): Record<GuildInviteAttributionStatus, number> {
    const counts = {
        ambiguous: 0,
        attributed: 0,
        'baseline-missing': 0,
        'not-applicable': 0,
        unavailable: 0,
    } satisfies Record<GuildInviteAttributionStatus, number>;

    for (const event of memberEvents) {
        counts[event.attributionStatus] += 1;
    }

    return counts;
}

function createTopInviters(
    memberEvents: GuildMemberFlowEventDocument[],
    inviteSnapshots: GuildInviteSnapshotDocument[]
): GuildOverviewAggregate['invites']['topInviters'] {
    const joinsByInviter = new Map<string, number>();

    for (const event of memberEvents) {
        if (event.eventType === 'join' && event.attributionStatus === 'attributed' && event.inviterUserId) {
            joinsByInviter.set(event.inviterUserId, (joinsByInviter.get(event.inviterUserId) ?? 0) + 1);
        }
    }

    return [...joinsByInviter.entries()]
        .map(([inviterUserId, attributedJoins]) => ({
            attributedJoins,
            inviteCodes: inviteSnapshots
                .filter((invite) => invite.inviterUserId === inviterUserId)
                .sort(compareInviteSnapshotDocuments)
                .map((invite) => ({ active: invite.active, code: invite.code, uses: invite.uses })),
            inviterUserId,
        }))
        .sort(
            (left, right) =>
                right.attributedJoins - left.attributedJoins || left.inviterUserId.localeCompare(right.inviterUserId)
        )
        .slice(0, 10);
}

function createTopChannels(
    messageActivityDays: GuildMessageActivityDayDocument[]
): GuildOverviewAggregate['messages']['topChannels'] {
    const messagesByChannel = new Map<string, number>();

    for (const day of messageActivityDays) {
        messagesByChannel.set(day.channelId, (messagesByChannel.get(day.channelId) ?? 0) + day.messageCount);
    }

    return [...messagesByChannel.entries()]
        .map(([channelId, messageCount]) => ({ channelId, messageCount }))
        .sort((left, right) => right.messageCount - left.messageCount || left.channelId.localeCompare(right.channelId))
        .slice(0, 10);
}

function findTrackingStartedAt(
    memberEvents: GuildMemberFlowEventDocument[],
    inviteSnapshots: GuildInviteSnapshotDocument[],
    messageActivityDays: GuildMessageActivityDayDocument[]
): string | undefined {
    const timestamps = [
        ...memberEvents.map((event) => Date.parse(event.occurredAt)),
        ...inviteSnapshots.map((snapshot) => Date.parse(snapshot.firstSeenAt)),
        ...messageActivityDays.map((day) => Date.parse(`${day.activityDate}T00:00:00.000Z`)),
    ].filter((timestamp) => Number.isFinite(timestamp));
    const earliest = Math.min(...timestamps);

    return Number.isFinite(earliest) ? new Date(earliest).toISOString() : undefined;
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

function compareInviteSnapshotDocuments(left: GuildInviteSnapshotDocument, right: GuildInviteSnapshotDocument): number {
    return left.code.localeCompare(right.code);
}

function formatUtcDate(value: string): string {
    return new Date(value).toISOString().slice(0, 10);
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
