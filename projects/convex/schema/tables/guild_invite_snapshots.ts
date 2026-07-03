import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
    encryptedOAuthTokenPayload,
    jsonValue,
    optionalNumber,
    optionalString,
    optionalTimestamp,
    timestamp,
} from '../shared.js';

export const guildInviteSnapshotsTable = defineTable({
    active: v.boolean(),
    channelId: optionalString,
    code: v.string(),
    expiresAt: optionalTimestamp,
    firstSeenAt: timestamp,
    guildId: v.string(),
    inviterUserId: optionalString,
    lastSeenAt: timestamp,
    legacyId: v.string(),
    maxUses: optionalNumber,
    revokedAt: optionalTimestamp,
    temporary: v.boolean(),
    uses: v.number(),
})
    .index('by_guild_active', ['guildId', 'active'])
    .index('by_guild_code', ['guildId', 'code'])
    .index('by_guild_inviter', ['guildId', 'inviterUserId'])
    .index('by_legacy', ['legacyId']);
