import { defineSchema } from 'convex/server';

import { coreTables } from './schema/core.js';
import { growthTables } from './schema/growth.js';
import { postingTables } from './schema/posting.js';
import { blueprintTables } from './schema/blueprint.js';

export default defineSchema({
    ...coreTables,
    ...postingTables,
    ...growthTables,
    ...blueprintTables,
});
