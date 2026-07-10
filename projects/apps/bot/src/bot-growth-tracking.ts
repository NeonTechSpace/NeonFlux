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

import type { BotFeatureHandlerContext, BotMessageCreatedEvent } from './bot-feature-types.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

type BotMemberJoinedEvent = {
    type: 'member.joined';
    guildId: string;
    userId: string;
    roleIds: readonly string[];
};

type BotMemberLeftEvent = Omit<BotMemberJoinedEvent, 'type'> & {
    type: 'member.left';
};

export type BotGrowthMemberEvent = BotMemberJoinedEvent | BotMemberLeftEvent;

type BotGrowthTrackingEvent = BotMessageCreatedEvent | BotGrowthMemberEvent;
const guildInviteTrackingTails = new Map<string, Promise<void>>();

export type BotGrowthTrackingResult =
    | { status: 'tracked' }
    | { status: 'ignored'; reason: 'bot-authored-message' | 'guild-not-processable' | 'no-feature-handler' };

export async function trackGrowthOverviewEvent(
    context: BotFeatureHandlerContext,
    event: BotGrowthTrackingEvent
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    switch (event.type) {
        case 'message.created':
            return trackMessageActivity(context, event);

        case 'member.joined':
            return serializeGuildInviteTracking(event.guildId, () => trackMemberJoin(context, event));

        case 'member.left':
            return trackMemberLeave(context, event);
    }
}

async function trackMessageActivity(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    if (event.authorIsBot || !event.guildId) {
        return ok({ status: 'ignored', reason: event.authorIsBot ? 'bot-authored-message' : 'guild-not-processable' });
    }

    const result = await recordGuildMessageActivity(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
    });

    return result.isOk() ? ok({ status: 'tracked' }) : err('database-error');
}

async function trackMemberJoin(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthMemberEvent, { type: 'member.joined' }>
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    const previousSnapshotsResult = await listGuildInviteSnapshots(context.db, { guildId: event.guildId });

    if (previousSnapshotsResult.isErr()) {
        return err('database-error');
    }

    const inviteReadResult = await readFluxerGuildInvites({
        client: context.client,
        guildId: event.guildId,
    });

    if (inviteReadResult.isErr()) {
        return recordJoin(context, event, { attributionStatus: 'unavailable' });
    }

    const currentInvites = inviteReadResult.value;
    const attribution = attributeInviteUsage(previousSnapshotsResult.value, currentInvites);
    const recordResult = await recordGuildMemberJoinWithInviteSnapshots(context.db, {
        ...attribution,
        guildId: event.guildId,
        invites: currentInvites.map(toInviteSnapshotInput),
        userId: event.userId,
    });

    if (recordResult.isErr()) {
        if (recordResult.error.type === 'database-error') return err('database-error');
        return recordJoin(context, event, { attributionStatus: 'unavailable' });
    }

    return ok({ status: 'tracked' });
}

async function trackMemberLeave(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthMemberEvent, { type: 'member.left' }>
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    const result = await recordGuildMemberFlowEvent(context.db, {
        guildId: event.guildId,
        userId: event.userId,
        eventType: 'leave',
        attributionStatus: 'not-applicable',
    });

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

async function serializeGuildInviteTracking<T>(guildId: string, operation: () => Promise<T>): Promise<T> {
    const previous = guildInviteTrackingTails.get(guildId) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    const tail = queued.then(
        () => undefined,
        () => undefined
    );
    guildInviteTrackingTails.set(guildId, tail);

    try {
        return await queued;
    } finally {
        if (guildInviteTrackingTails.get(guildId) === tail) guildInviteTrackingTails.delete(guildId);
    }
}

async function recordJoin(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthMemberEvent, { type: 'member.joined' }>,
    attribution: {
        attributionStatus: GuildInviteAttributionStatus;
        inviteCode?: string;
        inviterUserId?: string;
    }
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    const result = await recordGuildMemberFlowEvent(context.db, {
        guildId: event.guildId,
        userId: event.userId,
        eventType: 'join',
        attributionStatus: attribution.attributionStatus,
        ...(attribution.inviteCode ? { inviteCode: attribution.inviteCode } : {}),
        ...(attribution.inviterUserId ? { inviterUserId: attribution.inviterUserId } : {}),
    });

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
