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

export const deploymentConfigTable = defineTable({
    createdAt: timestamp,
    id: v.string(),
    instanceMode: v.union(v.literal('single'), v.literal('multi')),
    ownerIds: v.array(v.string()),
    publicWebUrl: optionalString,
    singleGuildId: optionalString,
    updatedAt: timestamp,
}).index('by_config_id', ['id']);
