import { cronJobs } from 'convex/server';

import { internal } from './_generated/api.js';

const crons = cronJobs();

crons.daily(
    'drain growth retention',
    { hourUTC: 3, minuteUTC: 15 },
    internal.growth.growth_retention.pruneGrowthRetentionBatch,
    { kind: 'member-events' }
);

export default crons;
