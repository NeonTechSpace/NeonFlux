import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const logSeverity = pgEnum('log_severity', ['debug', 'info', 'warn', 'error']);
export const instanceMode = pgEnum('instance_mode', ['single', 'multi']);

export const botInstallations = pgTable(
    'bot_installations',
    {
        guildId: text('guild_id').primaryKey(),
        mode: instanceMode('mode').notNull().default('multi'),
        installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('bot_installations_mode_idx').on(table.mode)]
);

export const featureSettings = pgTable(
    'feature_settings',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => botInstallations.guildId, { onDelete: 'cascade' }),
        feature: text('feature').notNull(),
        enabled: boolean('enabled').notNull().default(false),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('feature_settings_guild_feature_idx').on(table.guildId, table.feature),
        index('feature_settings_guild_idx').on(table.guildId),
    ]
);

export const botEvents = pgTable(
    'bot_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        eventName: text('event_name').notNull(),
        guildId: text('guild_id'),
        channelId: text('channel_id'),
        userId: text('user_id'),
        severity: logSeverity('severity').notNull().default('info'),
        context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('bot_events_guild_created_at_idx').on(table.guildId, table.createdAt),
        index('bot_events_event_name_idx').on(table.eventName),
    ]
);
