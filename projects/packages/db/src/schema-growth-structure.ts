import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { guilds } from './schema-core.js';

export const xpSettings = pgTable('xp_settings', {
    guildId: text('guild_id')
        .primaryKey()
        .references(() => guilds.guildId, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    messageXpMin: integer('message_xp_min').notNull().default(5),
    messageXpMax: integer('message_xp_max').notNull().default(10),
    cooldownSeconds: integer('cooldown_seconds').notNull().default(60),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guildUserXp = pgTable(
    'guild_user_xp',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        xp: integer('xp').notNull().default(0),
        level: integer('level').notNull().default(0),
        messageCount: integer('message_count').notNull().default(0),
        lastMessageXpAt: timestamp('last_message_xp_at', { withTimezone: true }),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('guild_user_xp_guild_user_idx').on(table.guildId, table.userId),
        index('guild_user_xp_guild_level_idx').on(table.guildId, table.level),
    ]
);

export const xpRoleRewards = pgTable(
    'xp_role_rewards',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        level: integer('level').notNull(),
        roleId: text('role_id').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex('xp_role_rewards_guild_level_role_idx').on(table.guildId, table.level, table.roleId)]
);

export const vcGeneratorRules = pgTable(
    'vc_generator_rules',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        sourceChannelId: text('source_channel_id').notNull(),
        categoryId: text('category_id'),
        nameTemplate: text('name_template').notNull(),
        enabled: boolean('enabled').notNull().default(true),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex('vc_generator_rules_guild_source_idx').on(table.guildId, table.sourceChannelId)]
);

export const generatedVoiceChannels = pgTable(
    'generated_voice_channels',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        ruleId: uuid('rule_id').references(() => vcGeneratorRules.id, { onDelete: 'set null' }),
        channelId: text('channel_id').notNull(),
        ownerUserId: text('owner_user_id'),
        status: text('status').notNull().default('active'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('generated_voice_channels_channel_idx').on(table.channelId),
        index('generated_voice_channels_guild_status_idx').on(table.guildId, table.status),
    ]
);

export const roleReconciliationRuns = pgTable(
    'role_reconciliation_runs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        status: text('status').notNull().default('pending'),
        summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('role_reconciliation_runs_guild_status_idx').on(table.guildId, table.status)]
);

export const roleReconciliationActions = pgTable(
    'role_reconciliation_actions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        runId: uuid('run_id')
            .notNull()
            .references(() => roleReconciliationRuns.id, { onDelete: 'cascade' }),
        actionType: text('action_type').notNull(),
        roleId: text('role_id'),
        status: text('status').notNull().default('pending'),
        details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('role_reconciliation_actions_run_status_idx').on(table.runId, table.status)]
);

export const structureExportSnapshots = pgTable(
    'structure_export_snapshots',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        createdByUserId: text('created_by_user_id'),
        source: text('source').notNull().default('bot'),
        snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('structure_export_snapshots_guild_created_idx').on(table.guildId, table.createdAt)]
);

export const structureImportRuns = pgTable(
    'structure_import_runs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        createdByUserId: text('created_by_user_id'),
        status: text('status').notNull().default('draft'),
        sourceSnapshotId: uuid('source_snapshot_id').references(() => structureExportSnapshots.id, {
            onDelete: 'set null',
        }),
        plan: jsonb('plan').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
        appliedAt: timestamp('applied_at', { withTimezone: true }),
    },
    (table) => [index('structure_import_runs_guild_status_idx').on(table.guildId, table.status)]
);

export const structureImportActions = pgTable(
    'structure_import_actions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        runId: uuid('run_id')
            .notNull()
            .references(() => structureImportRuns.id, { onDelete: 'cascade' }),
        actionType: text('action_type').notNull(),
        targetType: text('target_type').notNull(),
        targetId: text('target_id'),
        status: text('status').notNull().default('pending'),
        details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('structure_import_actions_run_status_idx').on(table.runId, table.status)]
);
