import { guildMemberFlowEventsTable } from './tables/guild_member_flow_events.js';
import { guildInviteSnapshotsTable } from './tables/guild_invite_snapshots.js';
import { guildMessageActivityDaysTable } from './tables/guild_message_activity_days.js';

export const growthTables = {
    guildMemberFlowEvents: guildMemberFlowEventsTable,
    guildInviteSnapshots: guildInviteSnapshotsTable,
    guildMessageActivityDays: guildMessageActivityDaysTable,
};
