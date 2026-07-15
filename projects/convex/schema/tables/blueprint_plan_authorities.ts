import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

const blueprintEntityKind = v.union(v.literal('role'), v.literal('category'), v.literal('channel'));

export const blueprintPlanAuthoritiesTable = defineTable({
    authorityDigest: v.string(),
    blockers: v.array(
        v.object({
            code: v.literal('unsupported-field-change'),
            fields: v.array(v.union(v.literal('type'), v.literal('url'))),
            sourceId: v.string(),
            targetId: v.string(),
            targetType: v.union(v.literal('category'), v.literal('channel')),
        })
    ),
    createdAt: timestamp,
    guildId: v.string(),
    mappings: v.object({
        categories: v.record(v.string(), v.string()),
        channels: v.record(v.string(), v.string()),
        roles: v.record(v.string(), v.string()),
    }),
    planId: v.id('blueprintPlans'),
    projectedSnapshot: jsonValue,
    provenance: v.object({
        requestedExportedAt: v.union(v.string(), v.null()),
        requestedGuildId: v.union(v.string(), v.null()),
        requestedSnapshotStoredAt: timestamp,
        source: v.union(v.literal('dashboard-json'), v.literal('backup'), v.literal('dashboard-recovery-plan')),
        sourcePlanId: optionalString,
        sourceRunId: optionalString,
    }),
    referenceAuthority: v.object({
        knownTargetKinds: v.record(v.string(), blueprintEntityKind),
        sourceTargetMap: v.record(v.string(), v.union(v.string(), v.null())),
    }),
    requestedSnapshot: jsonValue,
    roleProjection: jsonValue,
    version: v.literal(1),
}).index('by_plan', ['planId']);
