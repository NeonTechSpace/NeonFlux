import { guildGrowthDailyAggregatesTable } from './tables/guild_growth_daily_aggregates.js';
import { guildGrowthStatesTable } from './tables/guild_growth_states.js';
import { guildMemberFlowEventsTable } from './tables/guild_member_flow_events.js';
import { guildInviteSnapshotsTable } from './tables/guild_invite_snapshots.js';
import { guildMessageActivityReceiptsTable } from './tables/guild_message_activity_receipts.js';

export const growthTables = {
    guildGrowthDailyAggregates: guildGrowthDailyAggregatesTable,
    guildGrowthStates: guildGrowthStatesTable,
    guildMemberFlowEvents: guildMemberFlowEventsTable,
    guildInviteSnapshots: guildInviteSnapshotsTable,
    guildMessageActivityReceipts: guildMessageActivityReceiptsTable,
};
