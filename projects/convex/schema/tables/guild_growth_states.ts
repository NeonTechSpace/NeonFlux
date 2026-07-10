import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const guildGrowthStatesTable = defineTable({
    createdAt: timestamp,
    guildId: v.string(),
    inviteBaselineObservedAt: optionalTimestamp,
    lastInviteSyncAt: optionalTimestamp,
    updatedAt: timestamp,
}).index('by_guild', ['guildId']);
