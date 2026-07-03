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

export const fluxerOauthTokensTable = defineTable({
    accessToken: encryptedOAuthTokenPayload,
    accessTokenExpiresAt: timestamp,
    createdAt: timestamp,
    fluxerUserId: v.string(),
    invalidatedAt: optionalTimestamp,
    refreshToken: v.optional(encryptedOAuthTokenPayload),
    scopes: v.array(v.string()),
    tokenType: v.string(),
    updatedAt: timestamp,
})
    .index('by_fluxer_user_id', ['fluxerUserId'])
    .index('by_access_token_expires_at', ['accessTokenExpiresAt'])
    .index('by_invalidated_at', ['invalidatedAt']);
