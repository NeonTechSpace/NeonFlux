import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';
import { reactionRoleVersionPayloadValidator } from '../../reaction_roles/reaction_role_validators.js';

export const reactionRolePanelVersionsTable = defineTable({
    createdAt: timestamp,
    createdByUserId: v.string(),
    fingerprint: v.string(),
    guildId: v.string(),
    panelId: v.id('reactionRolePanels'),
    payload: reactionRoleVersionPayloadValidator,
    version: v.number(),
})
    .index('by_panel_version', ['panelId', 'version'])
    .index('by_guild_created', ['guildId', 'createdAt']);
