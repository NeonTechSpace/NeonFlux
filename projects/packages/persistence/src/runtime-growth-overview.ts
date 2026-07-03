import { api } from '@neonflux/convex/api';
import {
    incrementGuildMessageActivityDay as incrementGuildMessageActivityDayPostgres,
    listGuildInviteSnapshots as listGuildInviteSnapshotsPostgres,
    loadGuildOverviewAggregate as loadGuildOverviewAggregatePostgres,
    recordGuildMemberFlowEvent as recordGuildMemberFlowEventPostgres,
    syncGuildInviteSnapshots as syncGuildInviteSnapshotsPostgres,
    type GrowthOverviewRepositoryError,
    type GuildFeatureRepositoryError,
    type GuildInviteAttributionStatus,
    type GuildInviteSnapshotInput,
    type GuildInviteSnapshotRecord,
    type GuildMemberFlowEventRecord,
    type GuildMemberFlowEventType,
    type GuildMessageActivityDayRecord,
    type GuildOverviewAggregate,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    growth_overview: {
        incrementGuildMessageActivityDay: ConvexMutationReference;
        listGuildInviteSnapshots: ConvexQueryReference;
        loadGuildOverviewAggregate: ConvexQueryReference;
        recordGuildMemberFlowEvent: ConvexMutationReference;
        syncGuildInviteSnapshots: ConvexMutationReference;
    };
};

type PostgresGrowthOverviewDb = Parameters<typeof recordGuildMemberFlowEventPostgres>[0];
type GrowthOverviewDb = ConvexPersistenceDatabase | PostgresGrowthOverviewDb;

type ConvexGuildMemberFlowEventRecord = {
    attributionStatus: GuildInviteAttributionStatus;
    eventType: GuildMemberFlowEventType;
    guildId: string;
    id: string;
    inviteCode: string | null;
    inviterUserId: string | null;
    occurredAt: string;
    userId: string;
};

type ConvexGuildInviteSnapshotRecord = {
    active: boolean;
    channelId: string | null;
    code: string;
    expiresAt: string | null;
    firstSeenAt: string;
    guildId: string;
    id: string;
    inviterUserId: string | null;
    lastSeenAt: string;
    maxUses: number | null;
    revokedAt: string | null;
    temporary: boolean;
    uses: number;
};

type ConvexGuildMessageActivityDayRecord = {
    activityDate: string;
    channelId: string;
    guildId: string;
    id: string;
    messageCount: number;
    updatedAt: string;
};

type ConvexGuildOverviewAggregate = Omit<GuildOverviewAggregate, 'trackingStartedAt'> & {
    trackingStartedAt?: string;
};

export async function recordGuildMemberFlowEvent(
    db: GrowthOverviewDb,
    input: {
        attributionStatus?: GuildInviteAttributionStatus;
        eventType: GuildMemberFlowEventType;
        guildId: string;
        inviteCode?: string;
        inviterUserId?: string;
        occurredAt?: Date;
        userId: string;
    }
): Promise<Result<GuildMemberFlowEventRecord, GrowthOverviewRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return recordGuildMemberFlowEventPostgres(db, input);
    }

    const normalizedInput = normalizeMemberFlowInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const event = (await db.client.mutation(
            convexApi.growth_overview.recordGuildMemberFlowEvent,
            normalizedInput.value
        )) as ConvexGuildMemberFlowEventRecord;

        return ok(toGuildMemberFlowEventRecord(event));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function syncGuildInviteSnapshots(
    db: GrowthOverviewDb,
    input: { guildId: string; invites: readonly GuildInviteSnapshotInput[]; observedAt?: Date }
): Promise<Result<GuildInviteSnapshotRecord[], GrowthOverviewRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return syncGuildInviteSnapshotsPostgres(db, input);
    }

    const normalizedInput = normalizeInviteSyncInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const snapshots = (await db.client.mutation(
            convexApi.growth_overview.syncGuildInviteSnapshots,
            normalizedInput.value
        )) as ConvexGuildInviteSnapshotRecord[];

        return ok(snapshots.map(toGuildInviteSnapshotRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGuildInviteSnapshots(
    db: GrowthOverviewDb,
    input: { guildId: string }
): Promise<Result<GuildInviteSnapshotRecord[], GrowthOverviewRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return listGuildInviteSnapshotsPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const snapshots = (await db.client.query(convexApi.growth_overview.listGuildInviteSnapshots, {
            guildId: guildId.value,
        })) as ConvexGuildInviteSnapshotRecord[];

        return ok(snapshots.map(toGuildInviteSnapshotRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function incrementGuildMessageActivityDay(
    db: GrowthOverviewDb,
    input: { channelId: string; guildId: string; occurredAt?: Date }
): Promise<Result<GuildMessageActivityDayRecord, GrowthOverviewRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return incrementGuildMessageActivityDayPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const occurredAt = input.occurredAt ? normalizeDate(input.occurredAt, 'occurredAt') : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (occurredAt.isErr()) return err(occurredAt.error);

    try {
        const activity = (await db.client.mutation(convexApi.growth_overview.incrementGuildMessageActivityDay, {
            channelId: channelId.value,
            guildId: guildId.value,
            ...(occurredAt.value === undefined ? {} : { occurredAt: occurredAt.value }),
        })) as ConvexGuildMessageActivityDayRecord;

        return ok(toGuildMessageActivityDayRecord(activity));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function loadGuildOverviewAggregate(
    db: GrowthOverviewDb,
    input: { days?: number; guildId: string; now?: Date }
): Promise<Result<GuildOverviewAggregate, GrowthOverviewRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return loadGuildOverviewAggregatePostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const days = normalizeOverviewDays(input.days);
    const now = input.now ? normalizeDate(input.now, 'now') : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (days.isErr()) return err(days.error);
    if (now.isErr()) return err(now.error);

    try {
        const aggregate = (await db.client.query(convexApi.growth_overview.loadGuildOverviewAggregate, {
            ...(days.value === undefined ? {} : { days: days.value }),
            guildId: guildId.value,
            ...(now.value === undefined ? {} : { now: now.value }),
        })) as ConvexGuildOverviewAggregate;

        return ok(toGuildOverviewAggregate(aggregate));
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeMemberFlowInput(input: {
    attributionStatus?: GuildInviteAttributionStatus;
    eventType: GuildMemberFlowEventType;
    guildId: string;
    inviteCode?: string;
    inviterUserId?: string;
    occurredAt?: Date;
    userId: string;
}): Result<
    {
        attributionStatus?: GuildInviteAttributionStatus;
        eventType: GuildMemberFlowEventType;
        guildId: string;
        inviteCode?: string;
        inviterUserId?: string;
        occurredAt?: string;
        userId: string;
    },
    GrowthOverviewRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const eventType = normalizeMemberFlowEventType(input.eventType);
    const attributionStatus =
        input.attributionStatus === undefined ? ok(undefined) : normalizeAttributionStatus(input.attributionStatus);
    const occurredAt = input.occurredAt ? normalizeDate(input.occurredAt, 'occurredAt') : ok(undefined);
    const inviteCode = normalizeOptionalText(input.inviteCode);
    const inviterUserId = normalizeOptionalText(input.inviterUserId);

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (eventType.isErr()) return err(eventType.error);
    if (attributionStatus.isErr()) return err(attributionStatus.error);
    if (occurredAt.isErr()) return err(occurredAt.error);

    return ok({
        ...(attributionStatus.value === undefined ? {} : { attributionStatus: attributionStatus.value }),
        eventType: eventType.value,
        guildId: guildId.value,
        ...(inviteCode === undefined ? {} : { inviteCode }),
        ...(inviterUserId === undefined ? {} : { inviterUserId }),
        ...(occurredAt.value === undefined ? {} : { occurredAt: occurredAt.value }),
        userId: userId.value,
    });
}

function normalizeInviteSyncInput(input: {
    guildId: string;
    invites: readonly GuildInviteSnapshotInput[];
    observedAt?: Date;
}): Result<
    {
        guildId: string;
        invites: Array<{
            channelId?: string;
            code: string;
            expiresAt?: string | null;
            inviterUserId?: string;
            maxUses?: number | null;
            temporary?: boolean;
            uses?: number;
        }>;
        observedAt?: string;
    },
    GrowthOverviewRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const observedAt = input.observedAt ? normalizeDate(input.observedAt, 'observedAt') : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (observedAt.isErr()) return err(observedAt.error);

    const invites = [];

    for (const invite of input.invites) {
        const normalizedInvite = normalizeInviteSnapshotInput(invite);

        if (normalizedInvite.isErr()) return err(normalizedInvite.error);

        invites.push(normalizedInvite.value);
    }

    return ok({
        guildId: guildId.value,
        invites,
        ...(observedAt.value === undefined ? {} : { observedAt: observedAt.value }),
    });
}

function normalizeInviteSnapshotInput(input: GuildInviteSnapshotInput): Result<
    {
        channelId?: string;
        code: string;
        expiresAt?: string | null;
        inviterUserId?: string;
        maxUses?: number | null;
        temporary?: boolean;
        uses?: number;
    },
    GrowthOverviewRepositoryError
> {
    const code = normalizeRequiredText(input.code, 'code');
    const uses =
        input.uses === undefined || input.uses === null
            ? ok(undefined)
            : normalizeNonNegativeInteger(input.uses, 'uses');
    const maxUses =
        input.maxUses === undefined || input.maxUses === null
            ? ok(input.maxUses ?? undefined)
            : normalizeNonNegativeInteger(input.maxUses, 'maxUses');
    const expiresAt =
        input.expiresAt === undefined
            ? ok(undefined)
            : input.expiresAt === null
              ? ok(null)
              : normalizeDate(input.expiresAt, 'expiresAt');
    const inviterUserId = normalizeOptionalText(input.inviterUserId);
    const channelId = normalizeOptionalText(input.channelId);

    if (code.isErr()) return err(code.error);
    if (uses.isErr()) return err(uses.error);
    if (maxUses.isErr()) return err(maxUses.error);
    if (expiresAt.isErr()) return err(expiresAt.error);

    return ok({
        ...(channelId === undefined ? {} : { channelId }),
        code: code.value,
        ...(expiresAt.value === undefined ? {} : { expiresAt: expiresAt.value }),
        ...(inviterUserId === undefined ? {} : { inviterUserId }),
        ...(maxUses.value === undefined ? {} : { maxUses: maxUses.value }),
        ...(input.temporary === undefined || input.temporary === null ? {} : { temporary: input.temporary }),
        ...(uses.value === undefined ? {} : { uses: uses.value }),
    });
}

function toGuildMemberFlowEventRecord(record: ConvexGuildMemberFlowEventRecord): GuildMemberFlowEventRecord {
    return {
        attributionStatus: record.attributionStatus,
        eventType: record.eventType,
        guildId: record.guildId,
        id: record.id,
        inviteCode: record.inviteCode,
        inviterUserId: record.inviterUserId,
        occurredAt: new Date(record.occurredAt),
        userId: record.userId,
    };
}

function toGuildInviteSnapshotRecord(record: ConvexGuildInviteSnapshotRecord): GuildInviteSnapshotRecord {
    return {
        active: record.active,
        channelId: record.channelId,
        code: record.code,
        expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
        firstSeenAt: new Date(record.firstSeenAt),
        guildId: record.guildId,
        id: record.id,
        inviterUserId: record.inviterUserId,
        lastSeenAt: new Date(record.lastSeenAt),
        maxUses: record.maxUses,
        revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
        temporary: record.temporary,
        uses: record.uses,
    };
}

function toGuildMessageActivityDayRecord(record: ConvexGuildMessageActivityDayRecord): GuildMessageActivityDayRecord {
    return {
        activityDate: record.activityDate,
        channelId: record.channelId,
        guildId: record.guildId,
        id: record.id,
        messageCount: record.messageCount,
        updatedAt: new Date(record.updatedAt),
    };
}

function toGuildOverviewAggregate(record: ConvexGuildOverviewAggregate): GuildOverviewAggregate {
    return {
        dataHealth: record.dataHealth,
        invites: record.invites,
        memberFlow: record.memberFlow,
        messages: record.messages,
        ...(record.trackingStartedAt ? { trackingStartedAt: new Date(record.trackingStartedAt) } : {}),
    };
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeDate(value: Date, field: string): Result<string, GuildFeatureRepositoryError> {
    const timestamp = value.getTime();

    return Number.isFinite(timestamp) ? ok(value.toISOString()) : err({ field, type: 'invalid-value' });
}

function normalizeNonNegativeInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    return Number.isInteger(value) && value >= 0 ? ok(value) : err({ field, type: 'invalid-value' });
}

function normalizeOverviewDays(days: number | undefined): Result<number | undefined, GrowthOverviewRepositoryError> {
    if (days === undefined) {
        return ok(undefined);
    }

    return Number.isInteger(days) && days >= 1 && days <= 90 ? ok(days) : err({ field: 'days', type: 'invalid-value' });
}

function normalizeMemberFlowEventType(value: string): Result<GuildMemberFlowEventType, GrowthOverviewRepositoryError> {
    return value === 'join' || value === 'leave'
        ? ok(value)
        : err({ field: 'eventType', type: value ? 'invalid-value' : 'missing-input' });
}

function normalizeAttributionStatus(
    value: string
): Result<GuildInviteAttributionStatus, GrowthOverviewRepositoryError> {
    return value === 'ambiguous' ||
        value === 'attributed' ||
        value === 'baseline-missing' ||
        value === 'not-applicable' ||
        value === 'unavailable'
        ? ok(value)
        : err({ field: 'attributionStatus', type: 'invalid-value' });
}
