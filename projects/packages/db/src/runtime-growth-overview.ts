import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type {
    GrowthOverviewRepositoryError,
    GuildFeatureRepositoryError,
    GuildInviteAttributionStatus,
    GuildInviteSnapshotInput,
    GuildInviteSnapshotRecord,
    GuildInviteSnapshotState,
    GuildInviteSnapshotSyncResult,
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
    attributionStatus: GuildInviteAttributionStatus;
    eventType: GuildMemberFlowEventType;
    guildId: string;
    id: string;
    inviteCode: string | null;
    inviterUserId: string | null;
    membershipStartedAt: string | null;
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

type ConvexGuildMessageActivityRecord = {
    activityDate: string;
    guildId: string;
    shard: number;
    status: 'duplicate' | 'recorded';
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

export async function recordGuildMemberJoinWithInviteSnapshots(
    db: GrowthOverviewDb,
    input: {
        attributionStatus: Exclude<GuildInviteAttributionStatus, 'not-applicable'>;
        guildId: string;
        inviteCode?: string;
        inviterUserId?: string;
        invites: readonly GuildInviteSnapshotInput[];
        observedAt?: Date;
        membershipStartedAt: Date;
        userId: string;
    },
    options?: GrowthOverviewRequestOptions
): Promise<Result<GuildMemberFlowEventRecord, GrowthOverviewRepositoryError>> {
    const member = normalizeMemberFlowInput({
        attributionStatus: input.attributionStatus,
        eventType: 'join',
        guildId: input.guildId,
        ...(input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode }),
        ...(input.inviterUserId === undefined ? {} : { inviterUserId: input.inviterUserId }),
        occurredAt: input.membershipStartedAt,
        membershipStartedAt: input.membershipStartedAt,
        userId: input.userId,
    });
    const inviteSync = normalizeInviteSyncInput({
        guildId: input.guildId,
        invites: input.invites,
        ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    });

    if (member.isErr()) return err(member.error);
    if (inviteSync.isErr()) return err(inviteSync.error);
    if (!member.value.membershipStartedAt) return err({ field: 'membershipStartedAt', type: 'missing-input' });
    if (!member.value.attributionStatus || member.value.attributionStatus === 'not-applicable') {
        return err({ field: 'attributionStatus', type: 'invalid-value' });
    }

    try {
        const args = {
            attributionStatus: member.value.attributionStatus,
            guildId: member.value.guildId,
            invites: inviteSync.value.invites,
            userId: member.value.userId,
            membershipStartedAt: member.value.membershipStartedAt,
            ...(member.value.inviteCode === undefined ? {} : { inviteCode: member.value.inviteCode }),
            ...(member.value.inviterUserId === undefined ? {} : { inviterUserId: member.value.inviterUserId }),
            ...(inviteSync.value.observedAt === undefined ? {} : { observedAt: inviteSync.value.observedAt }),
        };
        const event = options
            ? await db.client.mutation(api.growth_overview.recordGuildMemberJoinWithInviteSnapshots, args, options)
            : await db.client.mutation(api.growth_overview.recordGuildMemberJoinWithInviteSnapshots, args);

        return ok(toGuildMemberFlowEventRecord(event));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function syncGuildInviteSnapshots(
    db: GrowthOverviewDb,
    input: { guildId: string; invites: readonly GuildInviteSnapshotInput[]; observedAt?: Date }
): Promise<Result<GuildInviteSnapshotSyncResult, GrowthOverviewRepositoryError>> {
    const normalizedInput = normalizeInviteSyncInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const result = await db.client.mutation(api.growth_overview.syncGuildInviteSnapshots, normalizedInput.value);

        return ok(result);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGuildInviteSnapshots(
    db: GrowthOverviewDb,
    input: { guildId: string },
    options?: GrowthOverviewRequestOptions
): Promise<Result<GuildInviteSnapshotState, GrowthOverviewRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const state = await db.client.query(
            api.growth_overview.listGuildInviteSnapshots,
            { guildId: guildId.value },
            options
        );

        return ok({
            baselineObserved: state.baselineObserved,
            snapshots: state.snapshots.map(toGuildInviteSnapshotRecord),
        });
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
    attributionStatus?: GuildInviteAttributionStatus;
    eventType: GuildMemberFlowEventType;
    guildId: string;
    inviteCode?: string;
    inviterUserId?: string;
    membershipStartedAt?: Date;
    occurredAt?: Date;
    userId: string;
}): Result<
    {
        attributionStatus?: GuildInviteAttributionStatus;
        eventType: GuildMemberFlowEventType;
        guildId: string;
        inviteCode?: string;
        inviterUserId?: string;
        membershipStartedAt?: string;
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
    const membershipStartedAt = input.membershipStartedAt
        ? normalizeDate(input.membershipStartedAt, 'membershipStartedAt')
        : ok(undefined);
    const inviteCode = normalizeOptionalText(input.inviteCode);
    const inviterUserId = normalizeOptionalText(input.inviterUserId);

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (eventType.isErr()) return err(eventType.error);
    if (attributionStatus.isErr()) return err(attributionStatus.error);
    if (occurredAt.isErr()) return err(occurredAt.error);
    if (membershipStartedAt.isErr()) return err(membershipStartedAt.error);

    return ok({
        ...(attributionStatus.value === undefined ? {} : { attributionStatus: attributionStatus.value }),
        eventType: eventType.value,
        guildId: guildId.value,
        ...(inviteCode === undefined ? {} : { inviteCode }),
        ...(inviterUserId === undefined ? {} : { inviterUserId }),
        ...(membershipStartedAt.value === undefined ? {} : { membershipStartedAt: membershipStartedAt.value }),
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
            ? ok(undefined)
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
        membershipStartedAt: record.membershipStartedAt ? new Date(record.membershipStartedAt) : null,
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
