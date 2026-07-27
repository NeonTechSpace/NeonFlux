import { guildGrowthDailyAggregatesTable } from './tables/guild_growth_daily_aggregates.js';
import { guildMemberFlowEventsTable } from './tables/guild_member_flow_events.js';
import { guildMessageActivityReceiptsTable } from './tables/guild_message_activity_receipts.js';

export const growthTables = {
    guildGrowthDailyAggregates: guildGrowthDailyAggregatesTable,
    guildMemberFlowEvents: guildMemberFlowEventsTable,
    guildMessageActivityReceipts: guildMessageActivityReceiptsTable,
};
