import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalNumber, timestamp } from '../shared.js';

export const profileFieldsTable = defineTable({
    createdAt: timestamp,
    fieldKey: v.string(),
    fieldType: v.string(),
    formId: v.id('profileForms'),
    label: v.string(),
    maxLength: optionalNumber,
    position: v.number(),
    required: v.boolean(),
    updatedAt: timestamp,
})
    .index('by_form_key', ['formId', 'fieldKey'])
    .index('by_form_position_label', ['formId', 'position', 'label']);
