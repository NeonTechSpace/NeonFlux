import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalNumber, timestamp } from '../shared.js';

export const profileFieldsTable = defineTable({
    createdAt: timestamp,
    fieldKey: v.string(),
    fieldType: v.string(),
    formLegacyId: v.string(),
    label: v.string(),
    legacyId: v.string(),
    maxLength: optionalNumber,
    position: v.number(),
    required: v.boolean(),
    updatedAt: timestamp,
})
    .index('by_form_key', ['formLegacyId', 'fieldKey'])
    .index('by_form_position_label', ['formLegacyId', 'position', 'label'])
    .index('by_legacy', ['legacyId']);
