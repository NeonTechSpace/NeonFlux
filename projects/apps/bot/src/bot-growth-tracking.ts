import {
    incrementGuildMessageActivityDay,
    listGuildInviteSnapshots,
    recordGuildMemberFlowEvent,
    syncGuildInviteSnapshots,
    type GuildInviteAttributionStatus,
    type GuildInviteSnapshotInput,
    type GuildInviteSnapshotRecord,
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
            return trackMemberJoin(context, event);

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

    const result = await incrementGuildMessageActivityDay(context.db, {
        guildId: event.guildId,
        channelId: event.channelId,
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
    const syncResult = await syncGuildInviteSnapshots(context.db, {
        guildId: event.guildId,
        invites: currentInvites.map(toInviteSnapshotInput),
    });

    if (syncResult.isErr()) {
        return err('database-error');
    }

    return recordJoin(context, event, attribution);
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
    previousSnapshots: GuildInviteSnapshotRecord[],
    currentInvites: FluxerGuildInvite[]
):
    | {
          attributionStatus: Extract<GuildInviteAttributionStatus, 'attributed'>;
          inviteCode: string;
          inviterUserId?: string;
      }
    | { attributionStatus: Exclude<GuildInviteAttributionStatus, 'not-applicable' | 'attributed'> } {
    if (previousSnapshots.length === 0) {
        return { attributionStatus: 'baseline-missing' };
    }

    const previousUsesByCode = new Map(previousSnapshots.map((invite) => [invite.code, invite.uses]));
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
