import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from '../src/schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const dataDir = join(projectRoot, 'data', 'pglite-migration-check');
const expectedTables = [
    'autorole_rules',
    'automod_events',
    'automod_rules',
    'bot_action_events',
    'bot_installations',
    'deployment_config',
    'fluxer_oauth_tokens',
    'generated_voice_channels',
    'guild_command_permission_rules',
    'guild_dashboard_permission_rules',
    'guild_defcon_exemptions',
    'guild_feature_settings',
    'guild_invite_snapshots',
    'guild_member_flow_events',
    'guild_message_activity_days',
    'guild_security_policies',
    'guild_user_xp',
    'guilds',
    'message_templates',
    'moderation_case_events',
    'moderation_cases',
    'moderation_temporary_actions',
    'posted_messages',
    'profile_fields',
    'profile_forms',
    'profile_submission_reviews',
    'profile_submissions',
    'reaction_role_assignments',
    'reaction_role_messages',
    'reaction_role_options',
    'role_reconciliation_actions',
    'role_reconciliation_runs',
    'structure_export_snapshots',
    'structure_import_actions',
    'structure_import_runs',
    'suggestion_boards',
    'suggestion_votes',
    'suggestions',
    'ticket_counters',
    'ticket_events',
    'ticket_members',
    'ticket_panels',
    'tickets',
    'vc_generator_rules',
    'vc_generator_control_panels',
    'verification_flows',
    'verification_records',
    'web_sessions',
    'xp_grants',
    'xp_role_rewards',
    'xp_settings',
    'xp_voice_sessions',
];

await rm(dataDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });

const client = new PGlite(dataDir);
const db = drizzle(client, { schema });

try {
    await migrate(db, { migrationsFolder });

    const tables = await client.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name;
    `);
    const tableNames = new Set(tables.rows.map((table) => table.table_name));

    for (const tableName of expectedTables) {
        if (!tableNames.has(tableName)) {
            throw new Error(`Missing migrated table: ${tableName}`);
        }
    }

    console.warn('PGlite migration validation passed');
} finally {
    await client.close();
}
