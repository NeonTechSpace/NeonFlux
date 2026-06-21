import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const logSeverity = pgEnum('log_severity', ['debug', 'info', 'warn', 'error']);

export const botInstallations = pgTable('bot_installations', {
    guildId: text('guild_id').primaryKey(),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guildFeatureSettings = pgTable(
    'guild_feature_settings',
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
        uniqueIndex('guild_feature_settings_guild_feature_idx').on(table.guildId, table.feature),
        index('guild_feature_settings_guild_idx').on(table.guildId),
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

export const webSessions = pgTable(
    'web_sessions',
    {
        id: text('id').primaryKey(),
        fluxerUserId: text('fluxer_user_id').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
    },
    (table) => [
        index('web_sessions_fluxer_user_id_idx').on(table.fluxerUserId),
        index('web_sessions_expires_at_idx').on(table.expiresAt),
    ]
);
