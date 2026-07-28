import { cronJobs } from 'convex/server';

import { internal } from './_generated/api.js';

const crons = cronJobs();

crons.daily(
    'prune expired auth state',
    { hourUTC: 2, minuteUTC: 15 },
    internal.auth.auth_store.pruneAuthStateBatch,
    {}
);

crons.daily(
    'prune dashboard posting operations',
    { hourUTC: 2, minuteUTC: 45 },
    internal.posting.pruneDashboardPostingOperations,
    {}
);

crons.daily(
    'drain growth retention',
    { hourUTC: 3, minuteUTC: 15 },
    internal.growth.growth_retention.pruneGrowthRetentionBatch,
    { kind: 'member-events' }
);

crons.daily(
    'drain historical retention',
    { hourUTC: 3, minuteUTC: 45 },
    internal.retention.historical_retention.pruneHistoricalRetentionBatch,
    {}
);

crons.daily(
    'drain reaction role retention',
    { hourUTC: 4, minuteUTC: 15 },
    internal.reaction_roles.reaction_role_retention.pruneReactionRoleHistoryBatch,
    {}
);

export default crons;
