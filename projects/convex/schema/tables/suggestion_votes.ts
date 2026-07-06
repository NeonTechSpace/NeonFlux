import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const suggestionVotesTable = defineTable({
    createdAt: timestamp,
    suggestionId: v.id('suggestions'),
    updatedAt: timestamp,
    userId: v.string(),
    vote: v.union(v.literal('down'), v.literal('up')),
}).index('by_suggestion_user', ['suggestionId', 'userId']);
