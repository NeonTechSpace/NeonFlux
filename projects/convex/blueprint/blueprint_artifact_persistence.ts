import {
    BLUEPRINT_ARTIFACT_MAX_BYTES,
    createBlueprintJsonArtifact,
    reconstructBlueprintJsonArtifact,
    type BlueprintArtifactManifestV1,
    type BlueprintJsonArtifactV1,
} from '@neonflux/blueprint/artifact-chunks';
import { normalizeBlueprintPlanAuthority } from '@neonflux/blueprint/persisted-authority';
import { normalizeBlueprintSnapshot } from '@neonflux/blueprint/snapshot';
import { getDocumentSize, type GenericId, type Value } from 'convex/values';

import type { Doc } from '../_generated/dataModel.js';
import type { MutationCtx, QueryCtx } from '../_generated/server.js';

export const MAX_BLUEPRINT_ARTIFACT_CHUNK_DOCUMENT_BYTES = 256 * 1024;

type ArtifactReadCtx = QueryCtx | MutationCtx;

export async function buildBlueprintArtifact(value: unknown): Promise<BlueprintJsonArtifactV1> {
    return await createBlueprintJsonArtifact(value, { maximumBytes: BLUEPRINT_ARTIFACT_MAX_BYTES });
}

export async function persistStructureBackupArtifactChunks(
    ctx: MutationCtx,
    input: {
        artifact: BlueprintJsonArtifactV1;
        backupId: GenericId<'structureBackups'>;
        createdAt: string;
        guildId: string;
    }
): Promise<void> {
    for (const chunk of input.artifact.chunks) {
        const document = {
            backupId: input.backupId,
            byteLength: chunk.byteLength,
            canonicalJsonChunk: chunk.canonicalJsonChunk,
            chunkDigest: chunk.chunkDigest,
            createdAt: input.createdAt,
            guildId: input.guildId,
            sequence: chunk.sequence,
        };
        assertChunkDocumentSize(document);
        await ctx.db.insert('structureBackupArtifactChunks', document);
    }
}

export async function loadStructureBackupArtifact(
    ctx: ArtifactReadCtx,
    backup: Pick<
        Doc<'structureBackups'>,
        '_id' | 'artifactBytes' | 'artifactChunkCount' | 'artifactContentDigest' | 'artifactVersion' | 'guildId'
    >
): Promise<Record<string, unknown>> {
    const manifest = requireArtifactManifest(backup, 'structure-backup-artifact-manifest-invalid');
    const chunks = await ctx.db
        .query('structureBackupArtifactChunks')
        .withIndex('by_backup_sequence', (index) => index.eq('backupId', backup._id))
        .order('asc')
        .take(manifest.artifactChunkCount + 1);
    if (chunks.some((chunk) => chunk.backupId !== backup._id || chunk.guildId !== backup.guildId)) {
        throw new Error('structure-backup-artifact-owner-invalid');
    }
    const value = await reconstructBlueprintJsonArtifact({
        manifest,
        chunks: chunks.map(toArtifactChunkValue),
    });
    const normalized = normalizeBlueprintSnapshot(value);
    if (normalized.type === 'invalid') throw new Error('structure-backup-artifact-invalid');
    return normalized.snapshot;
}

export async function deleteStructureBackupArtifactChunks(
    ctx: MutationCtx,
    backupId: GenericId<'structureBackups'>
): Promise<void> {
    const chunks = await ctx.db
        .query('structureBackupArtifactChunks')
        .withIndex('by_backup', (index) => index.eq('backupId', backupId))
        .collect();
    for (const chunk of chunks) await ctx.db.delete('structureBackupArtifactChunks', chunk._id);
}

export async function persistPlanAuthorityArtifact(
    ctx: MutationCtx,
    input: {
        artifact: BlueprintJsonArtifactV1;
        authorityDigest: string;
        createdAt: string;
        guildId: string;
        planId: GenericId<'blueprintPlans'>;
    }
): Promise<GenericId<'blueprintPlanAuthorities'>> {
    const authorityId = await ctx.db.insert('blueprintPlanAuthorities', {
        ...input.artifact.manifest,
        authorityDigest: input.authorityDigest,
        createdAt: input.createdAt,
        guildId: input.guildId,
        planId: input.planId,
        version: 1,
    });
    for (const chunk of input.artifact.chunks) {
        const document = {
            authorityId,
            byteLength: chunk.byteLength,
            canonicalJsonChunk: chunk.canonicalJsonChunk,
            chunkDigest: chunk.chunkDigest,
            createdAt: input.createdAt,
            guildId: input.guildId,
            planId: input.planId,
            sequence: chunk.sequence,
        };
        assertChunkDocumentSize(document);
        await ctx.db.insert('blueprintPlanAuthorityChunks', document);
    }
    return authorityId;
}

export async function loadPlanAuthorityArtifact(ctx: ArtifactReadCtx, manifest: Doc<'blueprintPlanAuthorities'>) {
    const chunks = await ctx.db
        .query('blueprintPlanAuthorityChunks')
        .withIndex('by_authority_sequence', (index) => index.eq('authorityId', manifest._id))
        .order('asc')
        .take(manifest.artifactChunkCount + 1);
    if (
        chunks.some(
            (chunk) =>
                chunk.authorityId !== manifest._id ||
                chunk.planId !== manifest.planId ||
                chunk.guildId !== manifest.guildId
        )
    ) {
        throw new Error('blueprint-plan-authority-artifact-owner-invalid');
    }
    let value: unknown;
    try {
        value = await reconstructBlueprintJsonArtifact({
            manifest,
            chunks: chunks.map(toArtifactChunkValue),
        });
    } catch {
        throw new Error('blueprint-plan-authority-integrity-invalid');
    }
    const normalized = normalizeBlueprintPlanAuthority(value);
    if (normalized.type === 'invalid') throw new Error('blueprint-plan-authority-integrity-invalid');
    return normalized.value;
}

function requireArtifactManifest(
    value: Partial<BlueprintArtifactManifestV1>,
    errorType: string
): BlueprintArtifactManifestV1 {
    if (
        value.artifactVersion !== 1 ||
        typeof value.artifactContentDigest !== 'string' ||
        !Number.isSafeInteger(value.artifactBytes) ||
        Number(value.artifactBytes) < 0 ||
        !Number.isSafeInteger(value.artifactChunkCount) ||
        Number(value.artifactChunkCount) < 1
    ) {
        throw new Error(errorType);
    }
    return {
        artifactBytes: Number(value.artifactBytes),
        artifactChunkCount: Number(value.artifactChunkCount),
        artifactContentDigest: value.artifactContentDigest,
        artifactVersion: 1,
    };
}

function toArtifactChunkValue(chunk: {
    byteLength: number;
    canonicalJsonChunk: string;
    chunkDigest: string;
    sequence: number;
}) {
    return {
        byteLength: chunk.byteLength,
        canonicalJsonChunk: chunk.canonicalJsonChunk,
        chunkDigest: chunk.chunkDigest,
        sequence: chunk.sequence,
    };
}

function assertChunkDocumentSize(document: Record<string, Value>): void {
    if (getDocumentSize(document) > MAX_BLUEPRINT_ARTIFACT_CHUNK_DOCUMENT_BYTES) {
        throw new Error('blueprint-artifact-chunk-document-too-large');
    }
}
