import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const structureBackupArtifactChunksTable = defineTable({
    backupId: v.id('structureBackups'),
    byteLength: v.number(),
    canonicalJsonChunk: v.string(),
    chunkDigest: v.string(),
    createdAt: timestamp,
    guildId: v.string(),
    sequence: v.number(),
})
    .index('by_backup', ['backupId'])
    .index('by_backup_sequence', ['backupId', 'sequence']);
