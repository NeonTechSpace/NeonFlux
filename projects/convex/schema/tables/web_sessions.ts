import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const webSessionsTable = defineTable({
    createdAt: timestamp,
    expiresAt: timestamp,
    fluxerUserId: v.string(),
    id: v.string(),
    revokedAt: optionalTimestamp,
})
    .index('by_session_id', ['id'])
    .index('by_expires_at', ['expiresAt'])
    .index('by_revoked_at', ['revokedAt'])
    .index('by_fluxer_user_id', ['fluxerUserId'])
    .index('by_fluxer_user_id_revoked_at_expires_at', ['fluxerUserId', 'revokedAt', 'expiresAt']);
