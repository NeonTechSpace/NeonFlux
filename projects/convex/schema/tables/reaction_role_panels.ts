import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';
import {
    reactionRoleModeValidator,
    reactionRolePanelStatusValidator,
} from '../../reaction_roles/reaction_role_validators.js';

export const reactionRolePanelsTable = defineTable({
    appliedVersionId: v.optional(v.id('reactionRolePanelVersions')),
    channelId: v.string(),
    createdAt: timestamp,
    createdByUserId: v.string(),
    desiredVersionId: v.optional(v.id('reactionRolePanelVersions')),
    errorCode: optionalString,
    generation: v.number(),
    guildId: v.string(),
    messageId: optionalString,
    mode: reactionRoleModeValidator,
    name: v.string(),
    reconciliationId: optionalString,
    status: reactionRolePanelStatusValidator,
    updatedAt: timestamp,
})
    .index('by_guild_updated', ['guildId', 'updatedAt'])
    .index('by_guild_status_updated', ['guildId', 'status', 'updatedAt'])
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_message', ['messageId'])
    .index('by_status_updated', ['status', 'updatedAt']);
