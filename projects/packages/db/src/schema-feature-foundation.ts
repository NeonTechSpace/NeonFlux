import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { guilds } from './schema-core.js';

export const moderationCases = pgTable(
    'moderation_cases',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        caseNumber: integer('case_number').notNull(),
        action: text('action').notNull(),
        targetUserId: text('target_user_id').notNull(),
        actorUserId: text('actor_user_id'),
        reason: text('reason'),
        status: text('status').notNull().default('open'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('moderation_cases_guild_case_number_idx').on(table.guildId, table.caseNumber),
        index('moderation_cases_guild_target_idx').on(table.guildId, table.targetUserId),
        index('moderation_cases_guild_status_idx').on(table.guildId, table.status),
    ]
);

export const moderationCaseEvents = pgTable(
    'moderation_case_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        caseId: uuid('case_id')
            .notNull()
            .references(() => moderationCases.id, { onDelete: 'cascade' }),
        eventType: text('event_type').notNull(),
        actorUserId: text('actor_user_id'),
        details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('moderation_case_events_case_idx').on(table.caseId)]
);

export const moderationTemporaryActions = pgTable(
    'moderation_temporary_actions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        caseId: uuid('case_id').references(() => moderationCases.id, { onDelete: 'set null' }),
        action: text('action').notNull(),
        targetUserId: text('target_user_id').notNull(),
        status: text('status').notNull().default('pending'),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('moderation_temporary_actions_guild_status_idx').on(table.guildId, table.status),
        index('moderation_temporary_actions_status_expires_idx').on(table.status, table.expiresAt),
    ]
);

export const botActionEvents = pgTable(
    'bot_action_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id').references(() => guilds.guildId, { onDelete: 'cascade' }),
        feature: text('feature').notNull(),
        action: text('action').notNull(),
        actorUserId: text('actor_user_id'),
        targetId: text('target_id'),
        metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('bot_action_events_guild_created_idx').on(table.guildId, table.createdAt),
        index('bot_action_events_feature_created_idx').on(table.feature, table.createdAt),
    ]
);

export const autoroleRules = pgTable(
    'autorole_rules',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        roleId: text('role_id').notNull(),
        name: text('name'),
        enabled: boolean('enabled').notNull().default(true),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('autorole_rules_guild_role_idx').on(table.guildId, table.roleId),
        index('autorole_rules_guild_enabled_idx').on(table.guildId, table.enabled),
    ]
);

export const reactionRoleMessages = pgTable(
    'reaction_role_messages',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        messageId: text('message_id').notNull(),
        kind: text('kind').notNull().default('reaction_role'),
        removeOnUnreact: boolean('remove_on_unreact').notNull().default(true),
        enabled: boolean('enabled').notNull().default(true),
        staleAt: timestamp('stale_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('reaction_role_messages_guild_message_idx').on(table.guildId, table.messageId),
        index('reaction_role_messages_guild_enabled_idx').on(table.guildId, table.enabled),
    ]
);

export const reactionRoleOptions = pgTable(
    'reaction_role_options',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        reactionRoleMessageId: uuid('reaction_role_message_id')
            .notNull()
            .references(() => reactionRoleMessages.id, { onDelete: 'cascade' }),
        emojiKey: text('emoji_key').notNull(),
        roleId: text('role_id').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('reaction_role_options_message_emoji_idx').on(table.reactionRoleMessageId, table.emojiKey),
        index('reaction_role_options_role_idx').on(table.roleId),
    ]
);

export const reactionRoleAssignments = pgTable(
    'reaction_role_assignments',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        messageId: text('message_id').notNull(),
        userId: text('user_id').notNull(),
        roleId: text('role_id').notNull(),
        emojiKey: text('emoji_key').notNull(),
        assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
        removedAt: timestamp('removed_at', { withTimezone: true }),
    },
    (table) => [
        uniqueIndex('reaction_role_assignments_guild_message_user_role_idx').on(
            table.guildId,
            table.messageId,
            table.userId,
            table.roleId
        ),
        index('reaction_role_assignments_guild_user_idx').on(table.guildId, table.userId),
    ]
);

export const verificationRecords = pgTable(
    'verification_records',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        method: text('method').notNull(),
        verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
    },
    (table) => [uniqueIndex('verification_records_guild_user_idx').on(table.guildId, table.userId)]
);

export const ticketPanels = pgTable(
    'ticket_panels',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        messageId: text('message_id'),
        title: text('title').notNull(),
        enabled: boolean('enabled').notNull().default(true),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('ticket_panels_guild_enabled_idx').on(table.guildId, table.enabled)]
);

export const ticketCounters = pgTable('ticket_counters', {
    guildId: text('guild_id')
        .primaryKey()
        .references(() => guilds.guildId, { onDelete: 'cascade' }),
    nextTicketNumber: integer('next_ticket_number').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tickets = pgTable(
    'tickets',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        panelId: uuid('panel_id').references(() => ticketPanels.id, { onDelete: 'set null' }),
        ticketNumber: integer('ticket_number').notNull(),
        channelId: text('channel_id'),
        openerUserId: text('opener_user_id').notNull(),
        status: text('status').notNull().default('open'),
        claimedByUserId: text('claimed_by_user_id'),
        openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
        closedAt: timestamp('closed_at', { withTimezone: true }),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('tickets_guild_ticket_number_idx').on(table.guildId, table.ticketNumber),
        index('tickets_guild_status_idx').on(table.guildId, table.status),
        index('tickets_guild_opener_idx').on(table.guildId, table.openerUserId),
    ]
);

export const ticketMembers = pgTable(
    'ticket_members',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        ticketId: uuid('ticket_id')
            .notNull()
            .references(() => tickets.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        role: text('role').notNull().default('participant'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex('ticket_members_ticket_user_idx').on(table.ticketId, table.userId)]
);

export const ticketEvents = pgTable(
    'ticket_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        ticketId: uuid('ticket_id')
            .notNull()
            .references(() => tickets.id, { onDelete: 'cascade' }),
        eventType: text('event_type').notNull(),
        actorUserId: text('actor_user_id'),
        details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('ticket_events_ticket_created_idx').on(table.ticketId, table.createdAt)]
);

export const suggestionBoards = pgTable(
    'suggestion_boards',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        channelId: text('channel_id').notNull(),
        name: text('name').notNull(),
        enabled: boolean('enabled').notNull().default(true),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex('suggestion_boards_guild_name_idx').on(table.guildId, table.name)]
);

export const suggestions = pgTable(
    'suggestions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        boardId: uuid('board_id').references(() => suggestionBoards.id, { onDelete: 'set null' }),
        channelId: text('channel_id'),
        messageId: text('message_id'),
        authorUserId: text('author_user_id').notNull(),
        status: text('status').notNull().default('pending'),
        content: text('content').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        closedAt: timestamp('closed_at', { withTimezone: true }),
    },
    (table) => [
        index('suggestions_guild_status_idx').on(table.guildId, table.status),
        index('suggestions_guild_author_idx').on(table.guildId, table.authorUserId),
    ]
);

export const suggestionVotes = pgTable(
    'suggestion_votes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        suggestionId: uuid('suggestion_id')
            .notNull()
            .references(() => suggestions.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        vote: text('vote').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex('suggestion_votes_suggestion_user_idx').on(table.suggestionId, table.userId)]
);

export const messageTemplates = pgTable(
    'message_templates',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        content: text('content'),
        embeds: jsonb('embeds').$type<unknown[]>().notNull().default([]),
        createdByUserId: text('created_by_user_id'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex('message_templates_guild_name_idx').on(table.guildId, table.name)]
);

export const postedMessages = pgTable(
    'posted_messages',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
        channelId: text('channel_id').notNull(),
        messageId: text('message_id').notNull(),
        createdByUserId: text('created_by_user_id'),
        purpose: text('purpose').notNull().default('manual'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('posted_messages_guild_channel_message_idx').on(table.guildId, table.channelId, table.messageId),
        index('posted_messages_guild_purpose_idx').on(table.guildId, table.purpose),
    ]
);

export const profileForms = pgTable(
    'profile_forms',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        approvalRequired: boolean('approval_required').notNull().default(true),
        outputChannelId: text('output_channel_id'),
        enabled: boolean('enabled').notNull().default(true),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex('profile_forms_guild_name_idx').on(table.guildId, table.name)]
);

export const profileFields = pgTable(
    'profile_fields',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        formId: uuid('form_id')
            .notNull()
            .references(() => profileForms.id, { onDelete: 'cascade' }),
        fieldKey: text('field_key').notNull(),
        label: text('label').notNull(),
        fieldType: text('field_type').notNull(),
        required: boolean('required').notNull().default(false),
        maxLength: integer('max_length'),
        position: integer('position').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex('profile_fields_form_key_idx').on(table.formId, table.fieldKey)]
);

export const profileSubmissions = pgTable(
    'profile_submissions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        guildId: text('guild_id')
            .notNull()
            .references(() => guilds.guildId, { onDelete: 'cascade' }),
        formId: uuid('form_id')
            .notNull()
            .references(() => profileForms.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull(),
        status: text('status').notNull().default('pending'),
        values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),
        submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
        reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('profile_submissions_guild_user_idx').on(table.guildId, table.userId),
        index('profile_submissions_guild_status_idx').on(table.guildId, table.status),
    ]
);

export const profileSubmissionReviews = pgTable(
    'profile_submission_reviews',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        submissionId: uuid('submission_id')
            .notNull()
            .references(() => profileSubmissions.id, { onDelete: 'cascade' }),
        reviewerUserId: text('reviewer_user_id').notNull(),
        decision: text('decision').notNull(),
        reason: text('reason'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('profile_submission_reviews_submission_idx').on(table.submissionId)]
);
