import { describe, expect, it } from 'vitest';

import {
    BLUEPRINT_ARTIFACT_MAX_BYTES,
    createBlueprintJsonArtifact,
    reconstructBlueprintJsonArtifact,
    sha256Utf8Text,
    utf8ByteLength,
} from './artifact-chunks.js';
import { canonicalJsonStringify } from './canonical-json.js';

describe('Blueprint JSON artifacts', () => {
    it('chunks canonical JSON on UTF-8 character boundaries', async () => {
        const artifact = await createBlueprintJsonArtifact(
            { ascii: 'abcdefghij', multibyte: '🙂é漢字'.repeat(5) },
            { chunkPayloadBytes: 11 }
        );

        expect(artifact.chunks.length).toBeGreaterThan(2);
        expect(artifact.chunks.every((chunk) => chunk.byteLength <= 11)).toBe(true);
        await expect(
            reconstructBlueprintJsonArtifact({ chunks: artifact.chunks, manifest: artifact.manifest })
        ).resolves.toStrictEqual({ ascii: 'abcdefghij', multibyte: '🙂é漢字'.repeat(5) });
    });

    it('accepts the exact artifact limit and rejects one byte less', async () => {
        const value = { payload: 'exact-boundary' };
        const exactBytes = utf8ByteLength(canonicalJsonStringify(value));

        await expect(createBlueprintJsonArtifact(value, { maximumBytes: exactBytes })).resolves.toBeDefined();
        await expect(createBlueprintJsonArtifact(value, { maximumBytes: exactBytes - 1 })).rejects.toThrow(
            'blueprint-artifact-too-large'
        );
    });

    it('enforces the production four-MiB artifact boundary exactly', async () => {
        const emptyEnvelopeBytes = utf8ByteLength(canonicalJsonStringify({ payload: '' }));
        const exactValue = {
            payload: 'a'.repeat(BLUEPRINT_ARTIFACT_MAX_BYTES - emptyEnvelopeBytes),
        };

        const exactArtifact = await createBlueprintJsonArtifact(exactValue);
        expect(exactArtifact.manifest.artifactBytes).toBe(BLUEPRINT_ARTIFACT_MAX_BYTES);
        await expect(createBlueprintJsonArtifact({ payload: `${exactValue.payload}a` })).rejects.toThrow(
            'blueprint-artifact-too-large'
        );
    });

    it('rejects missing, duplicate, and reordered chunks', async () => {
        const artifact = await createBlueprintJsonArtifact({ payload: 'a'.repeat(100) }, { chunkPayloadBytes: 20 });
        const first = artifact.chunks[0];
        const second = artifact.chunks[1];
        if (!first || !second) throw new Error('Expected a multi-chunk artifact.');

        await expect(
            reconstructBlueprintJsonArtifact({
                chunks: artifact.chunks.slice(1),
                manifest: artifact.manifest,
            })
        ).rejects.toThrow('blueprint-artifact-chunk-count-invalid');
        await expect(
            reconstructBlueprintJsonArtifact({
                chunks: [first, first, ...artifact.chunks.slice(2)],
                manifest: artifact.manifest,
            })
        ).rejects.toThrow('blueprint-artifact-chunk-sequence-invalid');
        await expect(
            reconstructBlueprintJsonArtifact({
                chunks: [second, first, ...artifact.chunks.slice(2)],
                manifest: artifact.manifest,
            })
        ).rejects.toThrow('blueprint-artifact-chunk-sequence-invalid');
    });

    it('rejects chunk digest, byte count, and overall digest mismatches', async () => {
        const artifact = await createBlueprintJsonArtifact({ payload: 'integrity' }, { chunkPayloadBytes: 8 });
        const first = artifact.chunks[0];
        if (!first) throw new Error('Expected an artifact chunk.');

        await expect(
            reconstructBlueprintJsonArtifact({
                chunks: [{ ...first, chunkDigest: '0'.repeat(64) }, ...artifact.chunks.slice(1)],
                manifest: artifact.manifest,
            })
        ).rejects.toThrow('blueprint-artifact-chunk-digest-invalid');
        await expect(
            reconstructBlueprintJsonArtifact({
                chunks: [{ ...first, byteLength: first.byteLength + 1 }, ...artifact.chunks.slice(1)],
                manifest: artifact.manifest,
            })
        ).rejects.toThrow('blueprint-artifact-chunk-bytes-invalid');
        await expect(
            reconstructBlueprintJsonArtifact({
                chunks: artifact.chunks,
                manifest: { ...artifact.manifest, artifactContentDigest: '0'.repeat(64) },
            })
        ).rejects.toThrow('blueprint-artifact-content-digest-invalid');
    });

    it('rejects parser-invalid and noncanonical JSON after digest verification', async () => {
        await expect(reconstructRawArtifact('{"invalid":')).rejects.toThrow('blueprint-artifact-json-invalid');
        await expect(reconstructRawArtifact('{ "valid": true }')).rejects.toThrow(
            'blueprint-artifact-json-not-canonical'
        );
    });
});

async function reconstructRawArtifact(canonicalJsonChunk: string): Promise<unknown> {
    const byteLength = utf8ByteLength(canonicalJsonChunk);
    const digest = await sha256Utf8Text(canonicalJsonChunk);
    return await reconstructBlueprintJsonArtifact({
        chunks: [{ byteLength, canonicalJsonChunk, chunkDigest: digest, sequence: 0 }],
        manifest: {
            artifactBytes: byteLength,
            artifactChunkCount: 1,
            artifactContentDigest: digest,
            artifactVersion: 1,
        },
    });
}
