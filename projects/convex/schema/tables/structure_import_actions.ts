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

export const structureImportActionsTable = defineTable({
    actionType: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    legacyId: v.string(),
    runLegacyId: v.string(),
    status: v.string(),
    targetId: optionalString,
    targetType: v.string(),
    updatedAt: timestamp,
})
    .index('by_run_created', ['runLegacyId', 'createdAt'])
    .index('by_run_status', ['runLegacyId', 'status'])
    .index('by_legacy', ['legacyId']);
