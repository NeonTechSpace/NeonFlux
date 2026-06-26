import { and, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeNonNegativeInteger,
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { guildInviteSnapshots, guildMemberFlowEvents, guildMessageActivityDays } from './schema.js';

export type GuildMemberFlowEventRecord = typeof guildMemberFlowEvents.$inferSelect;
export type GuildInviteSnapshotRecord = typeof guildInviteSnapshots.$inferSelect;
export type GuildMessageActivityDayRecord = typeof guildMessageActivityDays.$inferSelect;
export type GrowthOverviewRepositoryError = GuildFeatureRepositoryError;

export type GuildMemberFlowEventType = 'join' | 'leave';
export type GuildInviteAttributionStatus =
    | 'attributed'
    | 'baseline-missing'
    | 'ambiguous'
    | 'unavailable'
    | 'not-applicable';

export type GuildInviteSnapshotInput = {
    code: string;
    inviterUserId?: string | null;
    channelId?: string | null;
    uses?: number | null;
    maxUses?: number | null;
    expiresAt?: Date | null;
    temporary?: boolean | null;
};

export type GuildOverviewAggregate = {
    trackingStartedAt?: Date;
    memberFlow: {
        totalJoins: number;
        totalLeaves: number;
        netGrowth: number;
        graph: Array<{
            date: string;
            joins: number;
            leaves: number;
            netGrowth: number;
        }>;
    };
    invites: {
        activeInviteCount: number;
        totalInviteUses: number;
        attribution: Record<GuildInviteAttributionStatus, number>;
        topInviters: Array<{
            inviterUserId: string;
            attributedJoins: number;
            inviteCodes: Array<{
                code: string;
                uses: number;
                active: boolean;
            }>;
        }>;
    };
    messages: {
        totalMessages: number;
        graph: Array<{
            date: string;
            messageCount: number;
        }>;
        topChannels: Array<{
            channelId: string;
            messageCount: number;
        }>;
    };
    dataHealth: {
        hasMemberFlow: boolean;
        hasInviteSnapshots: boolean;
        hasMessageActivity: boolean;
    };
};

export async function recordGuildMemberFlowEvent(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        userId: string;
        eventType: GuildMemberFlowEventType;
        inviteCode?: string;
        inviterUserId?: string;
        attributionStatus?: GuildInviteAttributionStatus;
        occurredAt?: Date;
    }
): Promise<Result<GuildMemberFlowEventRecord, GrowthOverviewRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const occurredAt = normalizeOptionalDate(input.occurredAt, 'occurredAt');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (occurredAt.isErr()) return err(occurredAt.error);

    const attributionStatus =
        input.attributionStatus ?? (input.eventType === 'leave' ? 'not-applicable' : 'unavailable');

    if (!isGuildInviteAttributionStatus(attributionStatus)) {
        return err({ type: 'invalid-value', field: 'attributionStatus' });
    }

    try {
        const rows = await db
            .insert(guildMemberFlowEvents)
            .values({
                guildId: guildId.value,
                userId: userId.value,
                eventType: input.eventType,
                inviteCode: normalizeOptionalText(input.inviteCode),
                inviterUserId: normalizeOptionalText(input.inviterUserId),
                attributionStatus,
                ...(occurredAt.value ? { occurredAt: occurredAt.value } : {}),
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function syncGuildInviteSnapshots(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; invites: readonly GuildInviteSnapshotInput[]; observedAt?: Date }
): Promise<Result<GuildInviteSnapshotRecord[], GrowthOverviewRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const observedAt = normalizeOptionalDate(input.observedAt, 'observedAt');

    if (guildId.isErr()) return err(guildId.error);
    if (observedAt.isErr()) return err(observedAt.error);

    const normalizedInvites = normalizeInviteSnapshotInputs(input.invites);

    if (normalizedInvites.isErr()) return err(normalizedInvites.error);

    const currentCodes = new Set(normalizedInvites.value.map((invite) => invite.code));
    const seenAt = observedAt.value ?? new Date();

    try {
        const activeRows = await db
            .select()
            .from(guildInviteSnapshots)
            .where(and(eq(guildInviteSnapshots.guildId, guildId.value), eq(guildInviteSnapshots.active, true)));

        for (const activeRow of activeRows) {
            if (!currentCodes.has(activeRow.code)) {
                await db
                    .update(guildInviteSnapshots)
                    .set({
                        active: false,
                        revokedAt: seenAt,
                        lastSeenAt: seenAt,
                    })
                    .where(
                        and(
                            eq(guildInviteSnapshots.guildId, guildId.value),
                            eq(guildInviteSnapshots.code, activeRow.code)
                        )
                    );
            }
        }

        for (const invite of normalizedInvites.value) {
            await db
                .insert(guildInviteSnapshots)
                .values({
                    guildId: guildId.value,
                    code: invite.code,
                    inviterUserId: invite.inviterUserId,
                    channelId: invite.channelId,
                    uses: invite.uses,
                    maxUses: invite.maxUses,
                    expiresAt: invite.expiresAt,
                    temporary: invite.temporary,
                    active: true,
                    firstSeenAt: seenAt,
                    lastSeenAt: seenAt,
                    revokedAt: null,
                })
                .onConflictDoUpdate({
                    target: [guildInviteSnapshots.guildId, guildInviteSnapshots.code],
                    set: {
                        inviterUserId: invite.inviterUserId,
                        channelId: invite.channelId,
                        uses: invite.uses,
                        maxUses: invite.maxUses,
                        expiresAt: invite.expiresAt,
                        temporary: invite.temporary,
                        active: true,
                        lastSeenAt: seenAt,
                        revokedAt: null,
                    },
                });
        }

        return await listGuildInviteSnapshots(db, { guildId: guildId.value });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGuildInviteSnapshots(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<GuildInviteSnapshotRecord[], GrowthOverviewRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(guildInviteSnapshots)
            .where(eq(guildInviteSnapshots.guildId, guildId.value));

        return ok(rows.sort(compareInviteSnapshotRecords));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function incrementGuildMessageActivityDay(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; channelId: string; occurredAt?: Date }
): Promise<Result<GuildMessageActivityDayRecord, GrowthOverviewRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const occurredAt = normalizeOptionalDate(input.occurredAt, 'occurredAt');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (occurredAt.isErr()) return err(occurredAt.error);

    const updatedAt = occurredAt.value ?? new Date();
    const activityDate = formatUtcDate(updatedAt);

    try {
        const rows = await db
            .insert(guildMessageActivityDays)
            .values({
                guildId: guildId.value,
                channelId: channelId.value,
                activityDate,
                messageCount: 1,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [
                    guildMessageActivityDays.guildId,
                    guildMessageActivityDays.channelId,
                    guildMessageActivityDays.activityDate,
                ],
                set: {
                    messageCount: sql`${guildMessageActivityDays.messageCount} + 1`,
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function loadGuildOverviewAggregate(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; days?: number; now?: Date }
): Promise<Result<GuildOverviewAggregate, GrowthOverviewRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const days = normalizeOverviewDays(input.days);
    const now = normalizeOptionalDate(input.now, 'now');

    if (guildId.isErr()) return err(guildId.error);
    if (days.isErr()) return err(days.error);
    if (now.isErr()) return err(now.error);

    try {
        const [memberEvents, inviteSnapshots, messageActivityDays] = await Promise.all([
            db.select().from(guildMemberFlowEvents).where(eq(guildMemberFlowEvents.guildId, guildId.value)),
            db.select().from(guildInviteSnapshots).where(eq(guildInviteSnapshots.guildId, guildId.value)),
            db.select().from(guildMessageActivityDays).where(eq(guildMessageActivityDays.guildId, guildId.value)),
        ]);

        return ok(
            toGuildOverviewAggregate({
                memberEvents,
                inviteSnapshots,
                messageActivityDays,
                days: days.value,
                now: now.value ?? new Date(),
            })
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

type NormalizedInviteSnapshotInput = {
    code: string;
    inviterUserId?: string;
    channelId?: string;
    uses: number;
    maxUses: number | null;
    expiresAt: Date | null;
    temporary: boolean;
};

function normalizeInviteSnapshotInputs(
    invites: readonly GuildInviteSnapshotInput[]
): Result<NormalizedInviteSnapshotInput[], GrowthOverviewRepositoryError> {
    const inviteByCode = new Map<string, NormalizedInviteSnapshotInput>();

    for (const invite of invites) {
        const code = normalizeRequiredText(invite.code, 'code');
        const uses = normalizeNonNegativeInteger(invite.uses ?? 0, 'uses');
        const maxUses =
            invite.maxUses === null || invite.maxUses === undefined
                ? ok<number | null, GrowthOverviewRepositoryError>(null)
                : normalizeNonNegativeInteger(invite.maxUses, 'maxUses');
        const expiresAt = normalizeOptionalDate(invite.expiresAt ?? undefined, 'expiresAt');

        if (code.isErr()) return err(code.error);
        if (uses.isErr()) return err(uses.error);
        if (maxUses.isErr()) return err(maxUses.error);
        if (expiresAt.isErr()) return err(expiresAt.error);

        const normalizedInvite: NormalizedInviteSnapshotInput = {
            code: code.value,
            uses: uses.value,
            maxUses: maxUses.value,
            expiresAt: expiresAt.value ?? null,
            temporary: invite.temporary ?? false,
        };
        const inviterUserId = normalizeOptionalText(invite.inviterUserId);
        const channelId = normalizeOptionalText(invite.channelId);

        if (inviterUserId) {
            normalizedInvite.inviterUserId = inviterUserId;
        }

        if (channelId) {
            normalizedInvite.channelId = channelId;
        }

        inviteByCode.set(code.value, normalizedInvite);
    }

    return ok([...inviteByCode.values()]);
}

function toGuildOverviewAggregate({
    memberEvents,
    inviteSnapshots,
    messageActivityDays,
    days,
    now,
}: {
    memberEvents: GuildMemberFlowEventRecord[];
    inviteSnapshots: GuildInviteSnapshotRecord[];
    messageActivityDays: GuildMessageActivityDayRecord[];
    days: number;
    now: Date;
}): GuildOverviewAggregate {
    const graph = createMemberFlowGraph(memberEvents, days, now);
    const messageGraph = createMessageActivityGraph(messageActivityDays, days, now);
    const totalJoins = memberEvents.filter((event) => event.eventType === 'join').length;
    const totalLeaves = memberEvents.filter((event) => event.eventType === 'leave').length;
    const activeInviteSnapshots = inviteSnapshots.filter((invite) => invite.active);
    const trackingStartedAt = findTrackingStartedAt(memberEvents, inviteSnapshots, messageActivityDays);

    return {
        ...(trackingStartedAt ? { trackingStartedAt } : {}),
        memberFlow: {
            totalJoins,
            totalLeaves,
            netGrowth: totalJoins - totalLeaves,
            graph,
        },
        invites: {
            activeInviteCount: activeInviteSnapshots.length,
            totalInviteUses: activeInviteSnapshots.reduce((total, invite) => total + invite.uses, 0),
            attribution: createAttributionCounts(memberEvents),
            topInviters: createTopInviters(memberEvents, inviteSnapshots),
        },
        messages: {
            totalMessages: messageActivityDays.reduce((total, day) => total + day.messageCount, 0),
            graph: messageGraph,
            topChannels: createTopChannels(messageActivityDays),
        },
        dataHealth: {
            hasMemberFlow: memberEvents.length > 0,
            hasInviteSnapshots: inviteSnapshots.length > 0,
            hasMessageActivity: messageActivityDays.length > 0,
        },
    };
}

function createMessageActivityGraph(
    messageActivityDays: GuildMessageActivityDayRecord[],
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
        const date = formatUtcDate(day);

        return {
            date,
            messageCount: messageCountsByDate.get(date) ?? 0,
        };
    });
}

function createMemberFlowGraph(
    memberEvents: GuildMemberFlowEventRecord[],
    days: number,
    now: Date
): GuildOverviewAggregate['memberFlow']['graph'] {
    const graph: GuildOverviewAggregate['memberFlow']['graph'] = [];

    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
        const date = formatUtcDate(day);
        const dayEvents = memberEvents.filter((event) => formatUtcDate(event.occurredAt) === date);
        const joins = dayEvents.filter((event) => event.eventType === 'join').length;
        const leaves = dayEvents.filter((event) => event.eventType === 'leave').length;

        graph.push({
            date,
            joins,
            leaves,
            netGrowth: joins - leaves,
        });
    }

    return graph;
}

function createAttributionCounts(
    memberEvents: GuildMemberFlowEventRecord[]
): Record<GuildInviteAttributionStatus, number> {
    const counts = {
        attributed: 0,
        'baseline-missing': 0,
        ambiguous: 0,
        unavailable: 0,
        'not-applicable': 0,
    } satisfies Record<GuildInviteAttributionStatus, number>;

    for (const event of memberEvents) {
        if (isGuildInviteAttributionStatus(event.attributionStatus)) {
            counts[event.attributionStatus] += 1;
        }
    }

    return counts;
}

function createTopInviters(
    memberEvents: GuildMemberFlowEventRecord[],
    inviteSnapshots: GuildInviteSnapshotRecord[]
): GuildOverviewAggregate['invites']['topInviters'] {
    const joinsByInviter = new Map<string, number>();

    for (const event of memberEvents) {
        if (event.eventType === 'join' && event.attributionStatus === 'attributed' && event.inviterUserId) {
            joinsByInviter.set(event.inviterUserId, (joinsByInviter.get(event.inviterUserId) ?? 0) + 1);
        }
    }

    return [...joinsByInviter.entries()]
        .map(([inviterUserId, attributedJoins]) => ({
            inviterUserId,
            attributedJoins,
            inviteCodes: inviteSnapshots
                .filter((invite) => invite.inviterUserId === inviterUserId)
                .sort(compareInviteSnapshotRecords)
                .map((invite) => ({
                    code: invite.code,
                    uses: invite.uses,
                    active: invite.active,
                })),
        }))
        .sort(
            (left, right) =>
                right.attributedJoins - left.attributedJoins || left.inviterUserId.localeCompare(right.inviterUserId)
        )
        .slice(0, 10);
}

function createTopChannels(
    messageActivityDays: GuildMessageActivityDayRecord[]
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
    memberEvents: GuildMemberFlowEventRecord[],
    inviteSnapshots: GuildInviteSnapshotRecord[],
    messageActivityDays: GuildMessageActivityDayRecord[]
): Date | undefined {
    const timestamps = [
        ...memberEvents.map((event) => event.occurredAt.getTime()),
        ...inviteSnapshots.map((snapshot) => snapshot.firstSeenAt.getTime()),
        ...messageActivityDays.map((day) => new Date(`${day.activityDate}T00:00:00.000Z`).getTime()),
    ].filter((timestamp) => Number.isFinite(timestamp));
    const earliest = Math.min(...timestamps);

    return Number.isFinite(earliest) ? new Date(earliest) : undefined;
}

function normalizeOverviewDays(days: number | undefined): Result<number, GrowthOverviewRepositoryError> {
    if (days === undefined) {
        return ok(30);
    }

    if (!Number.isInteger(days) || days < 1 || days > 90) {
        return err({ type: 'invalid-value', field: 'days' });
    }

    return ok(days);
}

function normalizeOptionalDate(
    value: Date | undefined,
    field: string
): Result<Date | undefined, GrowthOverviewRepositoryError> {
    if (value === undefined) {
        return ok(undefined);
    }

    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        return err({ type: 'invalid-value', field });
    }

    return ok(value);
}

function isGuildInviteAttributionStatus(value: string): value is GuildInviteAttributionStatus {
    return (
        value === 'attributed' ||
        value === 'baseline-missing' ||
        value === 'ambiguous' ||
        value === 'unavailable' ||
        value === 'not-applicable'
    );
}

function compareInviteSnapshotRecords(left: GuildInviteSnapshotRecord, right: GuildInviteSnapshotRecord): number {
    return left.code.localeCompare(right.code);
}

function formatUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}
