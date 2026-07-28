import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const reactionRoleReconciliationDirtyUsersTable = defineTable({
    guildId: v.string(),
    panelId: v.id('reactionRolePanels'),
    reconciliationId: v.string(),
    updatedAt: timestamp,
    userId: v.string(),
})
    .index('by_panel_user', ['panelId', 'userId'])
    .index('by_panel_updated', ['panelId', 'updatedAt']);
