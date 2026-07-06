import { defineSchema } from 'convex/server';

import { coreTables } from './schema/core.js';
import { growthTables } from './schema/growth.js';
import { postingTables } from './schema/posting.js';
import { roleTables } from './schema/roles.js';
import { structureTables } from './schema/structure.js';

export default defineSchema({
    ...coreTables,
    ...roleTables,
    ...postingTables,
    ...growthTables,
    ...structureTables,
});
