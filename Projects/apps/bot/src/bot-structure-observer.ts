import { recordStructureObservedEvent } from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureEvent, BotFeatureHandlerContext } from './bot-feature-types.js';

type BotStructureObservedEvent = Extract<
    BotFeatureEvent,
    | { type: 'guild.lifecycle.updated' }
    | { type: 'role.created' | 'role.updated' | 'role.deleted' }
    | { type: 'channel.created' | 'channel.updated' | 'channel.deleted' }
>;

export type BotStructureObserverResult =
    | {
          status: 'recorded';
          action: 'event.import_export.structure_observed';
      }
    | { status: 'ignored'; reason: 'no-feature-handler' };

export async function recordObservedStructureEvent(
    context: BotFeatureHandlerContext,
    event: BotStructureObservedEvent
): Promise<Result<BotStructureObserverResult, 'database-error'>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const target = toStructureEventTarget(event);
    const result = await recordStructureObservedEvent(context.db, {
        guildId: event.guildId,
        eventType: event.type,
        targetType: target.targetType,
        ...(target.targetId ? { targetId: target.targetId } : {}),
    });

    if (result.isErr()) {
        return err('database-error');
    }

    return ok({
        status: 'recorded',
        action: 'event.import_export.structure_observed',
    });
}

function toStructureEventTarget(event: BotStructureObservedEvent): { targetType: string; targetId?: string } {
    switch (event.type) {
        case 'guild.lifecycle.updated':
            return { targetType: 'guild', targetId: event.guildId };

        case 'role.created':
        case 'role.updated':
        case 'role.deleted':
            return { targetType: 'role', targetId: event.roleId };

        case 'channel.created':
        case 'channel.updated':
        case 'channel.deleted':
            return { targetType: 'channel', targetId: event.channelId };
    }
}
