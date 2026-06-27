import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';

export type EncryptedOAuthTokenPayload = {
    version: string;
    iv: string;
    ciphertext: string;
    authTag: string;
};

export const guilds = pgTable('guilds', {
    guildId: text('guild_id').primaryKey(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const botInstallations = pgTable('bot_installations', {
    guildId: text('guild_id')
        .primaryKey()
        .references(() => guilds.guildId, { onDelete: 'cascade' }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deploymentConfig = pgTable('deployment_config', {
    id: text('id').primaryKey(),
    instanceMode: text('instance_mode').notNull(),
    singleGuildId: text('single_guild_id'),
    publicWebUrl: text('public_web_url'),
    ownerIds: text('owner_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guildFeatureSettings = pgTable(
    'guild_feature_settings',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
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

export const guildSecurityPolicies = pgTable(
    'guild_security_policies',
    {
        guildId: text('guild_id')
            .primaryKey()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        defconLevel: integer('defcon_level').notNull().default(3),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [check('guild_security_policies_defcon_level_check', sql`${table.defconLevel} in (1, 2, 3)`)]
);

export const guildCommandPermissionRules = pgTable(
    'guild_command_permission_rules',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        targetType: text('target_type').notNull(),
        targetId: text('target_id').notNull(),
        userIds: text('user_ids').array().notNull().default([]),
        roleIds: text('role_ids').array().notNull().default([]),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('guild_command_permission_rules_guild_target_idx').on(
            table.guildId,
            table.targetType,
            table.targetId
        ),
        index('guild_command_permission_rules_guild_idx').on(table.guildId),
        check('guild_command_permission_rules_target_type_check', sql`${table.targetType} in ('category', 'command')`),
    ]
);

export const guildDashboardPermissionRules = pgTable('guild_dashboard_permission_rules', {
    guildId: text('guild_id')
        .primaryKey()
        .references(() => guilds.guildId, { onDelete: 'cascade' }),
    userIds: text('user_ids').array().notNull().default([]),
    roleIds: text('role_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guildDefconExemptions = pgTable(
    'guild_defcon_exemptions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        category: text('category').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('guild_defcon_exemptions_guild_category_idx').on(table.guildId, table.category),
        index('guild_defcon_exemptions_guild_idx').on(table.guildId),
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

export const fluxerOauthTokens = pgTable(
    'fluxer_oauth_tokens',
    {
        fluxerUserId: text('fluxer_user_id').primaryKey(),
        accessToken: jsonb('access_token').$type<EncryptedOAuthTokenPayload>().notNull(),
        refreshToken: jsonb('refresh_token').$type<EncryptedOAuthTokenPayload>(),
        tokenType: text('token_type').notNull(),
        accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
        scopes: text('scopes').array().notNull(),
        invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('fluxer_oauth_tokens_access_token_expires_at_idx').on(table.accessTokenExpiresAt),
        index('fluxer_oauth_tokens_invalidated_at_idx').on(table.invalidatedAt),
    ]
);
