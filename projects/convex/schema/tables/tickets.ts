import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const ticketsTable = defineTable({
    channelId: optionalString,
    claimedByUserId: optionalString,
    closedAt: optionalTimestamp,
    guildId: v.string(),
    legacyId: v.string(),
    openedAt: timestamp,
    openerUserId: v.string(),
    panelLegacyId: optionalString,
    status: v.string(),
    ticketNumber: v.number(),
    updatedAt: timestamp,
})
    .index('by_guild_channel', ['guildId', 'channelId'])
    .index('by_guild_opener', ['guildId', 'openerUserId'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_guild_ticket_number', ['guildId', 'ticketNumber'])
    .index('by_legacy', ['legacyId'])
    .index('by_panel', ['panelLegacyId'])
    .index('by_panel_opener_status_opened', ['panelLegacyId', 'openerUserId', 'status', 'openedAt']);
