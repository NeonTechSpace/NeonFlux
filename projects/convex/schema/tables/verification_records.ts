import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const verificationRecordsTable = defineTable({
    guildId: v.string(),
    method: v.string(),
    revokedAt: optionalTimestamp,
    userId: v.string(),
    verifiedAt: timestamp,
}).index('by_guild_user', ['guildId', 'userId']);
