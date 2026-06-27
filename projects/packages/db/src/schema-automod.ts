import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { guilds } from './schema-core.js';

export const automodRules = pgTable(
    'automod_rules',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        triggerType: text('trigger_type').notNull(),
        actionType: text('action_type').notNull().default('record'),
        enabled: boolean('enabled').notNull().default(true),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('automod_rules_guild_name_idx').on(table.guildId, table.name),
        index('automod_rules_guild_enabled_idx').on(table.guildId, table.enabled),
        index('automod_rules_guild_trigger_idx').on(table.guildId, table.triggerType),
    ]
);

export const automodEvents = pgTable(
    'automod_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        ruleId: uuid('rule_id').references(() => automodRules.id, { onDelete: 'set null' }),
        messageId: text('message_id').notNull(),
        channelId: text('channel_id').notNull(),
        authorUserId: text('author_user_id').notNull(),
        triggerType: text('trigger_type').notNull(),
        actionType: text('action_type').notNull().default('record'),
        status: text('status').notNull().default('recorded'),
        details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('automod_events_guild_created_idx').on(table.guildId, table.createdAt),
        index('automod_events_rule_created_idx').on(table.ruleId, table.createdAt),
        index('automod_events_guild_message_idx').on(table.guildId, table.messageId),
    ]
);
