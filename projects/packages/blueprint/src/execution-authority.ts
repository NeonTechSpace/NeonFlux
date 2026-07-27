import { canonicalJsonStringify } from './canonical-json.js';
import { sha256CanonicalJson } from './canonical-hash.js';
import {
    normalizeBlueprintPlanExecutionAuthorityBody,
    normalizeBlueprintPlanExecutionAuthorityBucket,
    normalizeBlueprintPlanExecutionAuthorityManifest,
} from './persisted-authority-runtime.js';
import {
    BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT,
    BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
    type BlueprintPlanExecutionAuthorityBodyV1,
    type BlueprintPlanExecutionAuthorityBucketV1,
    type BlueprintPlanExecutionAuthorityManifestV1,
    type BlueprintPlanExecutionAuthorityV1,
} from './persisted-authority-types.js';
import type { BlueprintContractResult } from './runtime-contracts.js';

export type BlueprintPlanExecutionAuthorityPersistenceV1 = {
    authority: BlueprintPlanExecutionAuthorityV1;
    manifest: BlueprintPlanExecutionAuthorityManifestV1;
    buckets: BlueprintPlanExecutionAuthorityBucketV1[];
};

export async function getBlueprintPlanExecutionAuthorityBucket(referenceId: string): Promise<number> {
    const digest = await sha256CanonicalJson({
        domain: 'neonflux.blueprint.execution-authority-bucket-assignment',
        version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
        referenceId,
    });
    return Number.parseInt(digest.slice(0, 2), 16) % BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT;
}

export async function createBlueprintPlanExecutionAuthorityContentDigest(input: {
    guildId: string;
    authority: BlueprintPlanExecutionAuthorityBodyV1;
}): Promise<string> {
    const authority = validOrThrow(
        normalizeBlueprintPlanExecutionAuthorityBody(input.authority),
        'blueprint-plan-execution-authority-body-invalid'
    );
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.execution-authority-content',
        version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
        guildId: input.guildId,
        ...authority,
    });
}

export async function createBlueprintPlanExecutionAuthorityBucketDigest(input: {
    bucket: number;
    sourceTargetMap: Record<string, string | null>;
    knownTargetKinds: BlueprintPlanExecutionAuthorityBucketV1['knownTargetKinds'];
}): Promise<string> {
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.execution-authority-bucket',
        version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
        bucket: input.bucket,
        sourceTargetMap: input.sourceTargetMap,
        knownTargetKinds: input.knownTargetKinds,
    });
}

export async function createBlueprintPlanExecutionAuthorityManifestDigest(input: {
    contentDigest: string;
    bucketDigests: readonly string[];
}): Promise<string> {
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.execution-authority',
        version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
        contentDigest: input.contentDigest,
        bucketCount: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT,
        bucketDigests: [...input.bucketDigests],
    });
}

export async function createBlueprintPlanExecutionAuthorityPersistence(input: {
    planId: string;
    guildId: string;
    authority: BlueprintPlanExecutionAuthorityBodyV1;
    createdAt: string;
}): Promise<BlueprintPlanExecutionAuthorityPersistenceV1> {
    const body = validOrThrow(
        normalizeBlueprintPlanExecutionAuthorityBody(input.authority),
        'blueprint-plan-execution-authority-body-invalid'
    );
    const layout = await createBlueprintPlanExecutionAuthorityLayout(input.guildId, body);
    const { bucketValues, bucketDigests, contentDigest, executionAuthorityDigest } = layout;
    const populatedBuckets = bucketValues
        .map((value, bucket) => ({ bucket, value }))
        .filter(
            ({ value }) =>
                Object.keys(value.sourceTargetMap).length > 0 || Object.keys(value.knownTargetKinds).length > 0
        );
    const buckets = populatedBuckets.map(({ value, bucket }) =>
        validOrThrow(
            normalizeBlueprintPlanExecutionAuthorityBucket({
                version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
                planId: input.planId,
                guildId: input.guildId,
                bucket,
                ...value,
                bucketDigest: bucketDigests[bucket],
                createdAt: input.createdAt,
            }),
            'blueprint-plan-execution-authority-bucket-invalid'
        )
    );
    const manifest = validOrThrow(
        normalizeBlueprintPlanExecutionAuthorityManifest({
            version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
            planId: input.planId,
            guildId: input.guildId,
            ...(body.sourceGuildId ? { sourceGuildId: body.sourceGuildId } : {}),
            bucketCount: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT,
            contentDigest,
            bucketDigests,
            populatedBuckets: populatedBuckets.map(({ bucket }) => bucket),
            executionAuthorityDigest,
            createdAt: input.createdAt,
        }),
        'blueprint-plan-execution-authority-manifest-invalid'
    );
    return {
        authority: {
            version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
            planId: input.planId,
            guildId: input.guildId,
            ...body,
            contentDigest,
            executionAuthorityDigest,
            createdAt: input.createdAt,
        },
        manifest,
        buckets,
    };
}

export async function createBlueprintPlanExecutionAuthorityDigestFromBody(input: {
    guildId: string;
    authority: BlueprintPlanExecutionAuthorityBodyV1;
}): Promise<string> {
    const body = validOrThrow(
        normalizeBlueprintPlanExecutionAuthorityBody(input.authority),
        'blueprint-plan-execution-authority-body-invalid'
    );
    return (await createBlueprintPlanExecutionAuthorityLayout(input.guildId, body)).executionAuthorityDigest;
}

async function createBlueprintPlanExecutionAuthorityLayout(
    guildId: string,
    body: BlueprintPlanExecutionAuthorityBodyV1
) {
    const bucketValues: Array<{
        sourceTargetMap: Record<string, string | null>;
        knownTargetKinds: BlueprintPlanExecutionAuthorityBucketV1['knownTargetKinds'];
    }> = Array.from({ length: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT }, () => ({
        sourceTargetMap: {},
        knownTargetKinds: {},
    }));
    await Promise.all([
        ...Object.entries(body.sourceTargetMap).map(async ([referenceId, targetId]) => {
            const bucket = bucketValues[await getBlueprintPlanExecutionAuthorityBucket(referenceId)];
            if (!bucket) throw new Error('blueprint-plan-execution-authority-bucket-invalid');
            bucket.sourceTargetMap[referenceId] = targetId;
        }),
        ...Object.entries(body.knownTargetKinds).map(async ([referenceId, kind]) => {
            const bucket = bucketValues[await getBlueprintPlanExecutionAuthorityBucket(referenceId)];
            if (!bucket) throw new Error('blueprint-plan-execution-authority-bucket-invalid');
            bucket.knownTargetKinds[referenceId] = kind;
        }),
    ]);
    const bucketDigests = await Promise.all(
        bucketValues.map((value, bucket) => createBlueprintPlanExecutionAuthorityBucketDigest({ bucket, ...value }))
    );
    const contentDigest = await createBlueprintPlanExecutionAuthorityContentDigest({
        guildId,
        authority: body,
    });
    const executionAuthorityDigest = await createBlueprintPlanExecutionAuthorityManifestDigest({
        contentDigest,
        bucketDigests,
    });
    return { bucketValues, bucketDigests, contentDigest, executionAuthorityDigest };
}

export async function validateBlueprintPlanExecutionAuthorityPersistence(input: {
    manifest: unknown;
    buckets: readonly unknown[];
}): Promise<BlueprintContractResult<BlueprintPlanExecutionAuthorityV1>> {
    const manifest = normalizeBlueprintPlanExecutionAuthorityManifest(input.manifest);
    if (manifest.type === 'invalid') return manifest;
    if (input.buckets.length !== manifest.value.populatedBuckets.length) {
        return invalid('Blueprint plan execution authority bucket count is invalid.');
    }
    const normalizedBuckets: BlueprintPlanExecutionAuthorityBucketV1[] = [];
    for (const value of input.buckets) {
        const bucket = normalizeBlueprintPlanExecutionAuthorityBucket(value);
        if (bucket.type === 'invalid') return bucket;
        normalizedBuckets.push(bucket.value);
    }
    normalizedBuckets.sort((left, right) => left.bucket - right.bucket);
    const sourceTargetMap: Record<string, string | null> = {};
    const knownTargetKinds: BlueprintPlanExecutionAuthorityBucketV1['knownTargetKinds'] = {};
    const populatedBuckets = new Set(manifest.value.populatedBuckets);
    let storedBucketIndex = 0;
    for (let index = 0; index < BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT; index += 1) {
        const persistedBucket = populatedBuckets.has(index) ? normalizedBuckets[storedBucketIndex++] : undefined;
        const bucket =
            persistedBucket ??
            ({
                version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
                planId: manifest.value.planId,
                guildId: manifest.value.guildId,
                bucket: index,
                sourceTargetMap: {},
                knownTargetKinds: {},
                bucketDigest: manifest.value.bucketDigests[index] ?? '',
                createdAt: manifest.value.createdAt,
            } satisfies BlueprintPlanExecutionAuthorityBucketV1);
        if (
            bucket.bucket !== index ||
            bucket.planId !== manifest.value.planId ||
            bucket.guildId !== manifest.value.guildId ||
            bucket.createdAt !== manifest.value.createdAt ||
            bucket.bucketDigest !== manifest.value.bucketDigests[index]
        ) {
            return invalid('Blueprint plan execution authority bucket metadata is invalid.');
        }
        const digest = await createBlueprintPlanExecutionAuthorityBucketDigest(bucket);
        if (digest !== bucket.bucketDigest) {
            return invalid('Blueprint plan execution authority bucket digest is invalid.');
        }
        for (const referenceId of [...Object.keys(bucket.sourceTargetMap), ...Object.keys(bucket.knownTargetKinds)]) {
            if ((await getBlueprintPlanExecutionAuthorityBucket(referenceId)) !== index) {
                return invalid('Blueprint plan execution authority bucket membership is invalid.');
            }
        }
        for (const [key, value] of Object.entries(bucket.sourceTargetMap)) {
            if (Object.hasOwn(sourceTargetMap, key))
                return invalid('Blueprint plan execution authority source is duplicated.');
            sourceTargetMap[key] = value;
        }
        for (const [key, value] of Object.entries(bucket.knownTargetKinds)) {
            if (Object.hasOwn(knownTargetKinds, key))
                return invalid('Blueprint plan execution authority target is duplicated.');
            knownTargetKinds[key] = value;
        }
    }
    const bodyResult = normalizeBlueprintPlanExecutionAuthorityBody({
        ...(manifest.value.sourceGuildId ? { sourceGuildId: manifest.value.sourceGuildId } : {}),
        sourceTargetMap,
        knownTargetKinds,
        initialIdMap: Object.fromEntries(
            Object.entries(sourceTargetMap).filter((entry): entry is [string, string] => entry[1] !== null)
        ),
    });
    if (bodyResult.type === 'invalid') return bodyResult;
    const contentDigest = await createBlueprintPlanExecutionAuthorityContentDigest({
        guildId: manifest.value.guildId,
        authority: bodyResult.value,
    });
    const executionAuthorityDigest = await createBlueprintPlanExecutionAuthorityManifestDigest({
        contentDigest,
        bucketDigests: manifest.value.bucketDigests,
    });
    if (
        contentDigest !== manifest.value.contentDigest ||
        executionAuthorityDigest !== manifest.value.executionAuthorityDigest
    ) {
        return invalid('Blueprint plan execution authority manifest digest is invalid.');
    }
    return {
        type: 'valid',
        value: {
            version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
            planId: manifest.value.planId,
            guildId: manifest.value.guildId,
            ...bodyResult.value,
            contentDigest,
            executionAuthorityDigest,
            createdAt: manifest.value.createdAt,
        },
    };
}

export async function validateBlueprintPlanExecutionAuthorityManifestIntegrity(
    value: unknown
): Promise<BlueprintContractResult<BlueprintPlanExecutionAuthorityManifestV1>> {
    const manifest = normalizeBlueprintPlanExecutionAuthorityManifest(value);
    if (manifest.type === 'invalid') return manifest;
    const digest = await createBlueprintPlanExecutionAuthorityManifestDigest({
        contentDigest: manifest.value.contentDigest,
        bucketDigests: manifest.value.bucketDigests,
    });
    return digest === manifest.value.executionAuthorityDigest
        ? manifest
        : invalid('Blueprint plan execution authority manifest digest is invalid.');
}

export async function validateBlueprintPlanExecutionAuthorityBucketIntegrity(input: {
    bucket: unknown;
    manifest: BlueprintPlanExecutionAuthorityManifestV1;
    expectedBucket: number;
}): Promise<BlueprintContractResult<BlueprintPlanExecutionAuthorityBucketV1>> {
    const expectedPopulated = input.manifest.populatedBuckets.includes(input.expectedBucket);
    if (input.bucket === null && expectedPopulated) {
        return invalid('Blueprint plan execution authority populated bucket is missing.');
    }
    if (input.bucket !== null && !expectedPopulated) {
        return invalid('Blueprint plan execution authority unexpected bucket exists.');
    }
    const candidate =
        input.bucket ??
        ({
            version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
            planId: input.manifest.planId,
            guildId: input.manifest.guildId,
            bucket: input.expectedBucket,
            sourceTargetMap: {},
            knownTargetKinds: {},
            bucketDigest: input.manifest.bucketDigests[input.expectedBucket] ?? '',
            createdAt: input.manifest.createdAt,
        } satisfies BlueprintPlanExecutionAuthorityBucketV1);
    const bucket = normalizeBlueprintPlanExecutionAuthorityBucket(candidate);
    if (bucket.type === 'invalid') return bucket;
    if (
        bucket.value.bucket !== input.expectedBucket ||
        bucket.value.planId !== input.manifest.planId ||
        bucket.value.guildId !== input.manifest.guildId ||
        bucket.value.createdAt !== input.manifest.createdAt ||
        bucket.value.bucketDigest !== input.manifest.bucketDigests[input.expectedBucket]
    ) {
        return invalid('Blueprint plan execution authority bucket metadata is invalid.');
    }
    const digest = await createBlueprintPlanExecutionAuthorityBucketDigest(bucket.value);
    if (digest !== bucket.value.bucketDigest) {
        return invalid('Blueprint plan execution authority bucket digest is invalid.');
    }
    for (const referenceId of [
        ...Object.keys(bucket.value.sourceTargetMap),
        ...Object.keys(bucket.value.knownTargetKinds),
    ]) {
        if ((await getBlueprintPlanExecutionAuthorityBucket(referenceId)) !== input.expectedBucket) {
            return invalid('Blueprint plan execution authority bucket membership is invalid.');
        }
    }
    return bucket;
}

export function areBlueprintPlanExecutionAuthoritiesEqual(
    left: BlueprintPlanExecutionAuthorityBodyV1,
    right: BlueprintPlanExecutionAuthorityBodyV1
): boolean {
    return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function validOrThrow<T>(result: BlueprintContractResult<T>, code: string): T {
    if (result.type === 'invalid') throw new Error(`${code}:${result.message}`);
    return result.value;
}

function invalid<T>(message: string): BlueprintContractResult<T> {
    return { type: 'invalid', message };
}
