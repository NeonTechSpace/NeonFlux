import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const blueprintRunObservationsTable = defineTable({
    capabilityFingerprint: v.string(),
    fingerprintVersion: v.literal(2),
    guildId: v.string(),
    manifestJson: v.string(),
    observedAt: timestamp,
    phase: v.union(v.literal('restore'), v.literal('authorization')),
    runId: v.id('blueprintRuns'),
    source: v.literal('token-client'),
    structureFingerprint: v.string(),
})
    .index('by_run_phase', ['runId', 'phase'])
    .index('by_guild_observed', ['guildId', 'observedAt']);
