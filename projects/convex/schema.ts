import { defineSchema } from 'convex/server';

import { automodTables } from './schema/automod.js';
import { communityTables } from './schema/community.js';
import { coreTables } from './schema/core.js';
import { growthTables } from './schema/growth.js';
import { moderationTables } from './schema/moderation.js';
import { postingTables } from './schema/posting.js';
import { roleTables } from './schema/roles.js';
import { structureTables } from './schema/structure.js';
import { ticketTables } from './schema/tickets.js';
import { vcGeneratorTables } from './schema/vc_generator.js';

export default defineSchema({
    ...coreTables,
    ...automodTables,
    ...moderationTables,
    ...roleTables,
    ...ticketTables,
    ...postingTables,
    ...communityTables,
    ...growthTables,
    ...vcGeneratorTables,
    ...structureTables,
});
