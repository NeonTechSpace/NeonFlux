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
    voiceXpPerMinute: integer('voice_xp_per_minute').notNull().default(2),
    voiceMinimumMinutes: integer('voice_minimum_minutes').notNull().default(5),
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
        messageXp: integer('message_xp').notNull().default(0),
        voiceXp: integer('voice_xp').notNull().default(0),
        messageCount: integer('message_count').notNull().default(0),
        voiceSeconds: integer('voice_seconds').notNull().default(0),
        lastMessageXpAt: timestamp('last_message_xp_at', { withTimezone: true }),
        lastVoiceXpAt: timestamp('last_voice_xp_at', { withTimezone: true }),
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

export const xpGrants = pgTable(
    'xp_grants',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        source: text('source').notNull(),
        xp: integer('xp').notNull(),
        levelBefore: integer('level_before').notNull(),
        levelAfter: integer('level_after').notNull(),
        idempotencyKey: text('idempotency_key').notNull(),
        metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
        grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('xp_grants_guild_key_idx').on(table.guildId, table.idempotencyKey),
        index('xp_grants_guild_user_granted_idx').on(table.guildId, table.userId, table.grantedAt),
        index('xp_grants_guild_source_granted_idx').on(table.guildId, table.source, table.grantedAt),
    ]
);

export const xpVoiceSessions = pgTable(
    'xp_voice_sessions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        channelId: text('channel_id').notNull(),
        status: text('status').notNull().default('active'),
        startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
        endedAt: timestamp('ended_at', { withTimezone: true }),
        creditedSeconds: integer('credited_seconds').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('xp_voice_sessions_guild_user_status_idx').on(table.guildId, table.userId, table.status),
        index('xp_voice_sessions_guild_status_started_idx').on(table.guildId, table.status, table.startedAt),
    ]
);

export const guildMemberFlowEvents = pgTable(
    'guild_member_flow_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        eventType: text('event_type').notNull(),
        inviteCode: text('invite_code'),
        inviterUserId: text('inviter_user_id'),
        attributionStatus: text('attribution_status').notNull(),
        occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('guild_member_flow_events_guild_occurred_idx').on(table.guildId, table.occurredAt),
        index('guild_member_flow_events_guild_user_idx').on(table.guildId, table.userId),
        index('guild_member_flow_events_guild_event_idx').on(table.guildId, table.eventType),
    ]
);

export const guildInviteSnapshots = pgTable(
    'guild_invite_snapshots',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        code: text('code').notNull(),
        inviterUserId: text('inviter_user_id'),
        channelId: text('channel_id'),
        uses: integer('uses').notNull().default(0),
        maxUses: integer('max_uses'),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
        temporary: boolean('temporary').notNull().default(false),
        active: boolean('active').notNull().default(true),
        firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
        lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
    },
    (table) => [
        uniqueIndex('guild_invite_snapshots_guild_code_idx').on(table.guildId, table.code),
        index('guild_invite_snapshots_guild_inviter_idx').on(table.guildId, table.inviterUserId),
        index('guild_invite_snapshots_guild_active_idx').on(table.guildId, table.active),
    ]
);

export const guildMessageActivityDays = pgTable(
    'guild_message_activity_days',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        activityDate: text('activity_date').notNull(),
        messageCount: integer('message_count').notNull().default(0),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('guild_message_activity_days_guild_channel_date_idx').on(
            table.guildId,
            table.channelId,
            table.activityDate
        ),
        index('guild_message_activity_days_guild_date_idx').on(table.guildId, table.activityDate),
    ]
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
        index('generated_voice_channels_guild_rule_status_idx').on(table.guildId, table.ruleId, table.status),
    ]
);

export const vcGeneratorControlPanels = pgTable(
    'vc_generator_control_panels',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        ruleId: uuid('rule_id')
            .notNull()
            .references(() => vcGeneratorRules.id, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        messageId: text('message_id'),
        controlMode: text('control_mode').notNull().default('reaction'),
        status: text('status').notNull().default('active'),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
        staleAt: timestamp('stale_at', { withTimezone: true }),
    },
    (table) => [
        uniqueIndex('vc_generator_control_panels_guild_rule_idx').on(table.guildId, table.ruleId),
        uniqueIndex('vc_generator_control_panels_guild_message_idx').on(table.guildId, table.messageId),
        index('vc_generator_control_panels_guild_status_idx').on(table.guildId, table.status),
    ]
);

export const vcGeneratorControlRequests = pgTable(
    'vc_generator_control_requests',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        generatedChannelId: uuid('generated_channel_id')
            .notNull()
            .references(() => generatedVoiceChannels.id, { onDelete: 'cascade' }),
        panelChannelId: text('panel_channel_id').notNull(),
        targetChannelId: text('target_channel_id').notNull(),
        requesterUserId: text('requester_user_id').notNull(),
        controlAction: text('control_action').notNull(),
        status: text('status').notNull().default('pending'),
        promptMessageId: text('prompt_message_id'),
        value: text('value'),
        errorMessage: text('error_message'),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        completedAt: timestamp('completed_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('vc_generator_control_requests_guild_panel_requester_idx').on(
            table.guildId,
            table.panelChannelId,
            table.requesterUserId,
            table.status
        ),
        index('vc_generator_control_requests_generated_status_idx').on(table.generatedChannelId, table.status),
        index('vc_generator_control_requests_status_expires_idx').on(table.status, table.expiresAt),
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
