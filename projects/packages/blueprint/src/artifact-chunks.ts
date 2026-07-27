import { canonicalJsonStringify } from './canonical-json.js';

export const BLUEPRINT_ARTIFACT_VERSION = 1 as const;
export const BLUEPRINT_ARTIFACT_CHUNK_PAYLOAD_BYTES = 192 * 1024;
export const BLUEPRINT_ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;
export const BLUEPRINT_PLAN_COLD_MAX_BYTES = 12 * 1024 * 1024;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export type BlueprintArtifactManifestV1 = {
    artifactVersion: typeof BLUEPRINT_ARTIFACT_VERSION;
    artifactContentDigest: string;
    artifactBytes: number;
    artifactChunkCount: number;
};

export type BlueprintArtifactChunkV1 = {
    sequence: number;
    canonicalJsonChunk: string;
    chunkDigest: string;
    byteLength: number;
};

export type BlueprintJsonArtifactV1 = {
    canonicalJson: string;
    manifest: BlueprintArtifactManifestV1;
    chunks: BlueprintArtifactChunkV1[];
};

export async function createBlueprintJsonArtifact(
    value: unknown,
    options: { maximumBytes?: number; chunkPayloadBytes?: number } = {}
): Promise<BlueprintJsonArtifactV1> {
    const maximumBytes = normalizePositiveInteger(options.maximumBytes, BLUEPRINT_ARTIFACT_MAX_BYTES);
    const chunkPayloadBytes = normalizePositiveInteger(
        options.chunkPayloadBytes,
        BLUEPRINT_ARTIFACT_CHUNK_PAYLOAD_BYTES
    );
    const canonicalJson = canonicalJsonStringify(value);
    const artifactBytes = utf8ByteLength(canonicalJson);
    if (artifactBytes > maximumBytes) throw new Error('blueprint-artifact-too-large');

    const chunkTexts = splitUtf8Text(canonicalJson, chunkPayloadBytes);
    const chunks = await Promise.all(
        chunkTexts.map(async (canonicalJsonChunk, sequence) => ({
            byteLength: utf8ByteLength(canonicalJsonChunk),
            canonicalJsonChunk,
            chunkDigest: await sha256Utf8Text(canonicalJsonChunk),
            sequence,
        }))
    );
    return {
        canonicalJson,
        manifest: {
            artifactBytes,
            artifactChunkCount: chunks.length,
            artifactContentDigest: await sha256Utf8Text(canonicalJson),
            artifactVersion: BLUEPRINT_ARTIFACT_VERSION,
        },
        chunks,
    };
}

export async function reconstructBlueprintJsonArtifact(input: {
    chunks: readonly unknown[];
    manifest: unknown;
}): Promise<unknown> {
    const manifest = parseBlueprintArtifactManifest(input.manifest);
    if (input.chunks.length !== manifest.artifactChunkCount) {
        throw new Error('blueprint-artifact-chunk-count-invalid');
    }

    const chunks = input.chunks.map(parseBlueprintArtifactChunk);
    let artifactBytes = 0;
    const canonicalJsonChunks: string[] = [];
    for (let sequence = 0; sequence < chunks.length; sequence += 1) {
        const chunk = chunks[sequence];
        if (chunk?.sequence !== sequence) throw new Error('blueprint-artifact-chunk-sequence-invalid');
        const byteLength = utf8ByteLength(chunk.canonicalJsonChunk);
        if (byteLength !== chunk.byteLength) throw new Error('blueprint-artifact-chunk-bytes-invalid');
        if ((await sha256Utf8Text(chunk.canonicalJsonChunk)) !== chunk.chunkDigest) {
            throw new Error('blueprint-artifact-chunk-digest-invalid');
        }
        artifactBytes += byteLength;
        canonicalJsonChunks.push(chunk.canonicalJsonChunk);
    }

    const canonicalJson = canonicalJsonChunks.join('');
    if (artifactBytes !== manifest.artifactBytes || utf8ByteLength(canonicalJson) !== manifest.artifactBytes) {
        throw new Error('blueprint-artifact-bytes-invalid');
    }
    if ((await sha256Utf8Text(canonicalJson)) !== manifest.artifactContentDigest) {
        throw new Error('blueprint-artifact-content-digest-invalid');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(canonicalJson);
    } catch {
        throw new Error('blueprint-artifact-json-invalid');
    }
    if (canonicalJsonStringify(parsed) !== canonicalJson) throw new Error('blueprint-artifact-json-not-canonical');
    return parsed;
}

export async function sha256Utf8Text(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', utf8Encoder.encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function utf8ByteLength(value: string): number {
    return utf8Encoder.encode(value).byteLength;
}

function splitUtf8Text(value: string, maximumChunkBytes: number): string[] {
    if (value.length === 0) return [''];
    const bytes = utf8Encoder.encode(value);
    const chunks: string[] = [];
    let offset = 0;
    while (offset < bytes.byteLength) {
        let end = Math.min(offset + maximumChunkBytes, bytes.byteLength);
        while (end < bytes.byteLength && isUtf8ContinuationByte(bytes[end])) end -= 1;
        if (end === offset) throw new Error('blueprint-artifact-chunk-limit-invalid');
        chunks.push(utf8Decoder.decode(bytes.subarray(offset, end)));
        offset = end;
    }
    return chunks;
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
    return value !== undefined && (value & 0xc0) === 0x80;
}

function parseBlueprintArtifactManifest(value: unknown): BlueprintArtifactManifestV1 {
    if (
        !isRecord(value) ||
        value.artifactVersion !== BLUEPRINT_ARTIFACT_VERSION ||
        !isSha256(value.artifactContentDigest) ||
        !isNonNegativeSafeInteger(value.artifactBytes) ||
        !isPositiveSafeInteger(value.artifactChunkCount)
    ) {
        throw new Error('blueprint-artifact-manifest-invalid');
    }
    return {
        artifactBytes: value.artifactBytes,
        artifactChunkCount: value.artifactChunkCount,
        artifactContentDigest: value.artifactContentDigest,
        artifactVersion: BLUEPRINT_ARTIFACT_VERSION,
    };
}

function parseBlueprintArtifactChunk(value: unknown): BlueprintArtifactChunkV1 {
    if (
        !isRecord(value) ||
        !isNonNegativeSafeInteger(value.sequence) ||
        typeof value.canonicalJsonChunk !== 'string' ||
        !isSha256(value.chunkDigest) ||
        !isNonNegativeSafeInteger(value.byteLength)
    ) {
        throw new Error('blueprint-artifact-chunk-invalid');
    }
    return {
        byteLength: value.byteLength,
        canonicalJsonChunk: value.canonicalJsonChunk,
        chunkDigest: value.chunkDigest,
        sequence: value.sequence,
    };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!isPositiveSafeInteger(value)) throw new Error('blueprint-artifact-limit-invalid');
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return isNonNegativeSafeInteger(value) && value > 0;
}
