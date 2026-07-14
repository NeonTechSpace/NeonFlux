import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';
import { outgoingEmbedValidator } from '../../posting/message_validators.js';

export const messageTemplatesTable = defineTable({
    content: optionalString,
    createdAt: timestamp,
    createdByUserId: optionalString,
    embeds: v.array(outgoingEmbedValidator),
    guildId: v.string(),
    name: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_name', ['guildId', 'name'])
    .index('by_guild_updated', ['guildId', 'updatedAt']);
