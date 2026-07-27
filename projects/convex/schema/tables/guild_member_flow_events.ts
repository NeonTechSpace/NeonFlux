import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const guildMemberFlowEventsTable = defineTable({
    eventType: v.union(v.literal('join'), v.literal('leave')),
    guildId: v.string(),
    membershipStartedAt: optionalString,
    occurredAt: timestamp,
    userId: v.string(),
})
    .index('by_guild_user_membership', ['guildId', 'userId', 'membershipStartedAt'])
    .index('by_occurred', ['occurredAt']);
