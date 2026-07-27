import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type {
    GrowthOverviewRepositoryError,
    GuildFeatureRepositoryError,
    GuildMemberFlowEventRecord,
    GuildMemberFlowEventType,
    GuildMessageActivityRecord,
    GuildOverviewAggregate,
} from './contracts.js';
import type { ConvexDatabase } from './convex.js';

type GrowthOverviewDb = ConvexDatabase;

export type GrowthOverviewRequestOptions = {
    signal?: AbortSignal;
};

type ConvexGuildMemberFlowEventRecord = {
    eventType: GuildMemberFlowEventType;
    guildId: string;
    id: string;
    membershipStartedAt: string | null;
    occurredAt: string;
    userId: string;
};

type ConvexGuildMessageActivityRecord = {
    activityDate: string;
    guildId: string;
    shard: number;
    status: 'duplicate' | 'recorded';
};

type ConvexGuildOverviewAggregate = Omit<GuildOverviewAggregate, 'oldestRetainedActivityAt'> & {
    oldestRetainedActivityAt?: string;
};

export async function recordGuildMemberFlowEvent(
    db: GrowthOverviewDb,
    input: {
        eventType: GuildMemberFlowEventType;
        guildId: string;
        membershipStartedAt?: Date;
        occurredAt?: Date;
        userId: string;
    },
    options?: GrowthOverviewRequestOptions
): Promise<Result<GuildMemberFlowEventRecord, GrowthOverviewRepositoryError>> {
    const normalizedInput = normalizeMemberFlowInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const event = options
            ? await db.client.mutation(api.growth_overview.recordGuildMemberFlowEvent, normalizedInput.value, options)
            : await db.client.mutation(api.growth_overview.recordGuildMemberFlowEvent, normalizedInput.value);

        return ok(toGuildMemberFlowEventRecord(event));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordGuildMessageActivity(
    db: GrowthOverviewDb,
    input: { guildId: string; messageId: string; occurredAt?: Date },
    options?: GrowthOverviewRequestOptions
): Promise<Result<GuildMessageActivityRecord, GrowthOverviewRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const occurredAt = input.occurredAt ? normalizeDate(input.occurredAt, 'occurredAt') : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (occurredAt.isErr()) return err(occurredAt.error);

    try {
        const args = {
            guildId: guildId.value,
            messageId: messageId.value,
            ...(occurredAt.value === undefined ? {} : { occurredAt: occurredAt.value }),
        };
        const activity = options
            ? await db.client.mutation(api.growth_overview.recordGuildMessageActivity, args, options)
            : await db.client.mutation(api.growth_overview.recordGuildMessageActivity, args);

        return ok(toGuildMessageActivityRecord(activity));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function loadGuildOverviewAggregate(
    db: GrowthOverviewDb,
    input: { days?: number; guildId: string; now?: Date }
): Promise<Result<GuildOverviewAggregate, GrowthOverviewRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const days = normalizeOverviewDays(input.days);
    const now = input.now ? normalizeDate(input.now, 'now') : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (days.isErr()) return err(days.error);
    if (now.isErr()) return err(now.error);

    try {
        const aggregate = await db.client.query(api.growth_overview.loadGuildOverviewAggregate, {
            ...(days.value === undefined ? {} : { days: days.value }),
            guildId: guildId.value,
            ...(now.value === undefined ? {} : { now: now.value }),
        });

        return ok(toGuildOverviewAggregate(aggregate));
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeMemberFlowInput(input: {
    eventType: GuildMemberFlowEventType;
    guildId: string;
    membershipStartedAt?: Date;
    occurredAt?: Date;
    userId: string;
}): Result<
    {
        eventType: GuildMemberFlowEventType;
        guildId: string;
        membershipStartedAt?: string;
        occurredAt?: string;
        userId: string;
    },
    GrowthOverviewRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const eventType = normalizeMemberFlowEventType(input.eventType);
    const occurredAt = input.occurredAt ? normalizeDate(input.occurredAt, 'occurredAt') : ok(undefined);
    const membershipStartedAt = input.membershipStartedAt
        ? normalizeDate(input.membershipStartedAt, 'membershipStartedAt')
        : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (eventType.isErr()) return err(eventType.error);
    if (occurredAt.isErr()) return err(occurredAt.error);
    if (membershipStartedAt.isErr()) return err(membershipStartedAt.error);
    if (eventType.value === 'join' && membershipStartedAt.value === undefined) {
        return err({ field: 'membershipStartedAt', type: 'missing-input' });
    }
    if (eventType.value === 'leave' && membershipStartedAt.value !== undefined) {
        return err({ field: 'membershipStartedAt', type: 'invalid-value' });
    }

    return ok({
        eventType: eventType.value,
        guildId: guildId.value,
        ...(membershipStartedAt.value === undefined ? {} : { membershipStartedAt: membershipStartedAt.value }),
        ...(occurredAt.value === undefined ? {} : { occurredAt: occurredAt.value }),
        userId: userId.value,
    });
}

function toGuildMemberFlowEventRecord(record: ConvexGuildMemberFlowEventRecord): GuildMemberFlowEventRecord {
    return {
        eventType: record.eventType,
        guildId: record.guildId,
        id: record.id,
        membershipStartedAt: record.membershipStartedAt ? new Date(record.membershipStartedAt) : null,
        occurredAt: new Date(record.occurredAt),
        userId: record.userId,
    };
}

function toGuildMessageActivityRecord(record: ConvexGuildMessageActivityRecord): GuildMessageActivityRecord {
    return {
        activityDate: record.activityDate,
        guildId: record.guildId,
        shard: record.shard,
        status: record.status,
    };
}

function toGuildOverviewAggregate(record: ConvexGuildOverviewAggregate): GuildOverviewAggregate {
    return {
        activityPresence: record.activityPresence,
        memberFlow: record.memberFlow,
        messages: record.messages,
        windowDays: record.windowDays,
        ...(record.oldestRetainedActivityAt
            ? { oldestRetainedActivityAt: new Date(record.oldestRetainedActivityAt) }
            : {}),
    };
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

function normalizeDate(value: Date, field: string): Result<string, GuildFeatureRepositoryError> {
    const timestamp = value.getTime();

    return Number.isFinite(timestamp) ? ok(value.toISOString()) : err({ field, type: 'invalid-value' });
}

function normalizeOverviewDays(days: number | undefined): Result<number | undefined, GrowthOverviewRepositoryError> {
    if (days === undefined) return ok(undefined);

    return Number.isInteger(days) && days >= 1 && days <= 90 ? ok(days) : err({ field: 'days', type: 'invalid-value' });
}

function normalizeMemberFlowEventType(value: string): Result<GuildMemberFlowEventType, GrowthOverviewRepositoryError> {
    return value === 'join' || value === 'leave'
        ? ok(value)
        : err({ field: 'eventType', type: value ? 'invalid-value' : 'missing-input' });
}
