import { xpSettingsTable } from './tables/xp_settings.js';
import { guildUserXpTable } from './tables/guild_user_xp.js';
import { xpRoleRewardsTable } from './tables/xp_role_rewards.js';
import { xpGrantsTable } from './tables/xp_grants.js';
import { xpVoiceSessionsTable } from './tables/xp_voice_sessions.js';
import { guildMemberFlowEventsTable } from './tables/guild_member_flow_events.js';
import { guildInviteSnapshotsTable } from './tables/guild_invite_snapshots.js';
import { guildMessageActivityDaysTable } from './tables/guild_message_activity_days.js';

export const growthTables = {
    xpSettings: xpSettingsTable,
    guildUserXp: guildUserXpTable,
    xpRoleRewards: xpRoleRewardsTable,
    xpGrants: xpGrantsTable,
    xpVoiceSessions: xpVoiceSessionsTable,
    guildMemberFlowEvents: guildMemberFlowEventsTable,
    guildInviteSnapshots: guildInviteSnapshotsTable,
    guildMessageActivityDays: guildMessageActivityDaysTable,
};
