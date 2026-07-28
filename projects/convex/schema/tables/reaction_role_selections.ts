import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const reactionRoleSelectionsTable = defineTable({
    createdAt: timestamp,
    emojiKey: v.string(),
    generation: v.number(),
    grantOwnership: v.union(v.literal('panel'), v.literal('preexisting'), v.literal('pending')),
    guildId: v.string(),
    optionId: v.string(),
    panelId: v.id('reactionRolePanels'),
    revision: v.number(),
    roleId: v.string(),
    updatedAt: timestamp,
    userId: v.string(),
})
    .index('by_panel_user', ['panelId', 'userId'])
    .index('by_panel_generation', ['panelId', 'generation'])
    .index('by_panel_option', ['panelId', 'optionId'])
    .index('by_guild_user', ['guildId', 'userId']);
