import {
    listGuildInviteSnapshots,
    recordGuildMemberFlowEvent,
    recordGuildMemberJoinWithInviteSnapshots,
    recordGuildMessageActivity,
    type GuildInviteAttributionStatus,
    type GuildInviteSnapshotInput,
    type GuildInviteSnapshotState,
} from '@neonflux/db';
import { readFluxerGuildInvites, type FluxerGuildInvite } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext, BotGrowthTelemetryEvent } from './bot-feature-types.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

type BotGrowthTrackingEvent = BotGrowthTelemetryEvent;

type BotGrowthTrackingOptions = {
    signal?: AbortSignal;
};

export type BotGrowthTrackingResult =
    | { status: 'tracked' }
    | { status: 'ignored'; reason: 'bot-authored-message' | 'guild-not-processable' | 'no-feature-handler' };

export async function trackGrowthOverviewEvent(
    context: BotFeatureHandlerContext,
    event: BotGrowthTrackingEvent,
    options: BotGrowthTrackingOptions = {}
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    options.signal?.throwIfAborted();
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    switch (event.type) {
        case 'message.created':
            return trackMessageActivity(context, event, options);

        case 'member.joined':
            return trackMemberJoin(context, event, options);

        case 'member.left':
            return trackMemberLeave(context, event, options);
    }
}

async function trackMessageActivity(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthTelemetryEvent, { type: 'message.created' }>,
    options: BotGrowthTrackingOptions
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    if (event.authorIsBot || !event.guildId) {
        return ok({ status: 'ignored', reason: event.authorIsBot ? 'bot-authored-message' : 'guild-not-processable' });
    }

    const input = {
        guildId: event.guildId,
        messageId: event.messageId,
        occurredAt: event.occurredAt,
    };
    const result = options.signal
        ? await recordGuildMessageActivity(context.db, input, { signal: options.signal })
        : await recordGuildMessageActivity(context.db, input);

    return result.isOk() ? ok({ status: 'tracked' }) : err('database-error');
}

async function trackMemberJoin(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthTelemetryEvent, { type: 'member.joined' }>,
    options: BotGrowthTrackingOptions
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    const previousSnapshotsResult = options.signal
        ? await listGuildInviteSnapshots(context.db, { guildId: event.guildId }, { signal: options.signal })
        : await listGuildInviteSnapshots(context.db, { guildId: event.guildId });

    if (previousSnapshotsResult.isErr()) {
        return err('database-error');
    }

    const inviteReadResult = await readFluxerGuildInvites({
        client: context.client,
        guildId: event.guildId,
    });
    options.signal?.throwIfAborted();

    if (inviteReadResult.isErr()) {
        return recordJoin(context, event, { attributionStatus: 'unavailable' }, options);
    }

    const currentInvites = inviteReadResult.value;
    const attribution = attributeInviteUsage(previousSnapshotsResult.value, currentInvites);
    const input = {
        ...attribution,
        guildId: event.guildId,
        invites: currentInvites.map(toInviteSnapshotInput),
        membershipStartedAt: event.membershipStartedAt,
        userId: event.userId,
    };
    const recordResult = options.signal
        ? await recordGuildMemberJoinWithInviteSnapshots(context.db, input, { signal: options.signal })
        : await recordGuildMemberJoinWithInviteSnapshots(context.db, input);

    if (recordResult.isErr()) {
        if (recordResult.error.type === 'database-error') return err('database-error');
        return recordJoin(context, event, { attributionStatus: 'unavailable' }, options);
    }

    return ok({ status: 'tracked' });
}

async function trackMemberLeave(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthTelemetryEvent, { type: 'member.left' }>,
    options: BotGrowthTrackingOptions
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    const input = {
        guildId: event.guildId,
        userId: event.userId,
        eventType: 'leave',
        attributionStatus: 'not-applicable',
    } as const;
    const result = options.signal
        ? await recordGuildMemberFlowEvent(context.db, input, { signal: options.signal })
        : await recordGuildMemberFlowEvent(context.db, input);

    return result.isOk() ? ok({ status: 'tracked' }) : err('database-error');
}

function attributeInviteUsage(
    previousState: GuildInviteSnapshotState,
    currentInvites: FluxerGuildInvite[]
):
    | {
          attributionStatus: Extract<GuildInviteAttributionStatus, 'attributed'>;
          inviteCode: string;
          inviterUserId?: string;
      }
    | { attributionStatus: Exclude<GuildInviteAttributionStatus, 'not-applicable' | 'attributed'> } {
    if (!previousState.baselineObserved) {
        return { attributionStatus: 'baseline-missing' };
    }

    const previousUsesByCode = new Map(previousState.snapshots.map((invite) => [invite.code, invite.uses]));
    const candidates = currentInvites.filter((invite) => invite.uses > (previousUsesByCode.get(invite.code) ?? 0));

    if (candidates.length === 1) {
        const candidate = candidates[0];

        if (!candidate) {
            return { attributionStatus: 'unavailable' };
        }

        return {
            attributionStatus: 'attributed',
            inviteCode: candidate.code,
            ...(candidate.inviterUserId ? { inviterUserId: candidate.inviterUserId } : {}),
        };
    }

    if (candidates.length > 1) {
        return { attributionStatus: 'ambiguous' };
    }

    return { attributionStatus: 'unavailable' };
}

async function recordJoin(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthTelemetryEvent, { type: 'member.joined' }>,
    attribution: {
        attributionStatus: GuildInviteAttributionStatus;
        inviteCode?: string;
        inviterUserId?: string;
    },
    options: BotGrowthTrackingOptions
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    const input = {
        guildId: event.guildId,
        userId: event.userId,
        eventType: 'join',
        attributionStatus: attribution.attributionStatus,
        membershipStartedAt: event.membershipStartedAt,
        occurredAt: event.membershipStartedAt,
        ...(attribution.inviteCode ? { inviteCode: attribution.inviteCode } : {}),
        ...(attribution.inviterUserId ? { inviterUserId: attribution.inviterUserId } : {}),
    } as const;
    const result = options.signal
        ? await recordGuildMemberFlowEvent(context.db, input, { signal: options.signal })
        : await recordGuildMemberFlowEvent(context.db, input);

    return result.isOk() ? ok({ status: 'tracked' }) : err('database-error');
}

function toInviteSnapshotInput(invite: FluxerGuildInvite): GuildInviteSnapshotInput {
    return {
        code: invite.code,
        ...(invite.inviterUserId ? { inviterUserId: invite.inviterUserId } : {}),
        ...(invite.channelId ? { channelId: invite.channelId } : {}),
        uses: invite.uses,
        ...(invite.maxUses !== null ? { maxUses: invite.maxUses } : {}),
        ...(invite.expiresAt ? { expiresAt: invite.expiresAt } : {}),
        temporary: invite.temporary,
    };
}
