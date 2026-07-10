import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const guildMemberFlowEventsTable = defineTable({
    attributionStatus: v.union(
        v.literal('ambiguous'),
        v.literal('attributed'),
        v.literal('baseline-missing'),
        v.literal('not-applicable'),
        v.literal('unavailable')
    ),
    eventType: v.union(v.literal('join'), v.literal('leave')),
    guildId: v.string(),
    inviteCode: optionalString,
    inviterUserId: optionalString,
    occurredAt: timestamp,
    userId: v.string(),
})
    .index('by_guild_event', ['guildId', 'eventType'])
    .index('by_guild_occurred', ['guildId', 'occurredAt'])
    .index('by_guild_user', ['guildId', 'userId'])
    .index('by_occurred', ['occurredAt']);
