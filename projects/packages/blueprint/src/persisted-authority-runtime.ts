import { parseBlueprintMutationFenceManifest, type BlueprintMutationFenceManifestV2 } from './mutation-fence.js';
import type { BlueprintEntityKind, BlueprintPlanBlocker, BlueprintPlanMappings } from './plan.js';
import {
    BLUEPRINT_PLAN_AUTHORITY_VERSION,
    BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT,
    BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
    BLUEPRINT_PREFLIGHT_EVIDENCE_VERSION,
    BLUEPRINT_RUN_CURSOR_VERSION,
    BLUEPRINT_RUN_VERIFICATION_EVIDENCE_VERSION,
    type BlueprintPlanAuthorityBodyV1,
    type BlueprintPlanAuthorityProvenanceV1,
    type BlueprintPlanAuthorityV1,
    type BlueprintPlanExecutionAuthorityBodyV1,
    type BlueprintPlanExecutionAuthorityBucketV1,
    type BlueprintPlanExecutionAuthorityManifestV1,
    type BlueprintPlanExecutionAuthorityV1,
    type BlueprintPlanReferenceAuthorityV1,
    type BlueprintPreflightEvidenceV1,
    type BlueprintRunCursorV1,
    type BlueprintRunVerificationEvidenceV1,
    type BlueprintVerificationResult,
    type BlueprintVerificationStatus,
} from './persisted-authority-types.js';
import { normalizeBlueprintPreflightReport } from './preflight-report.js';
import type { BlueprintRoleProjection } from './role-projection.js';
import type { BlueprintContractResult } from './runtime-contracts.js';
import { normalizeBlueprintSnapshot } from './snapshot.js';

const entityKinds = new Set<BlueprintEntityKind>(['role', 'category', 'channel']);
const maximumLedgerEntries = 10_000;

export function normalizeBlueprintPlanAuthority(value: unknown): BlueprintContractResult<BlueprintPlanAuthorityV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'version',
            'planId',
            'guildId',
            'requestedSnapshot',
            'projectedSnapshot',
            'roleProjection',
            'mappings',
            'referenceAuthority',
            'blockers',
            'provenance',
            'authorityDigest',
            'createdAt',
        ]) ||
        value.version !== BLUEPRINT_PLAN_AUTHORITY_VERSION ||
        !isCanonicalText(value.planId) ||
        !isCanonicalText(value.guildId) ||
        !isSha256(value.authorityDigest) ||
        !isTimestamp(value.createdAt)
    ) {
        return invalid('Blueprint plan authority metadata is malformed.');
    }
    const body = normalizeBlueprintPlanAuthorityBody({
        requestedSnapshot: value.requestedSnapshot,
        projectedSnapshot: value.projectedSnapshot,
        roleProjection: value.roleProjection,
        mappings: value.mappings,
        referenceAuthority: value.referenceAuthority,
        blockers: value.blockers,
        provenance: value.provenance,
    });
    if (body.type === 'invalid') return body;
    if (
        body.value.projectedSnapshot.guildId !== value.guildId ||
        body.value.referenceAuthority.knownTargetKinds[value.guildId] !== 'role'
    ) {
        return invalid('Blueprint plan authority target guild reference is malformed.');
    }

    return {
        type: 'valid',
        value: {
            version: BLUEPRINT_PLAN_AUTHORITY_VERSION,
            planId: value.planId,
            guildId: value.guildId,
            ...body.value,
            authorityDigest: value.authorityDigest,
            createdAt: value.createdAt,
        },
    };
}

export function normalizeBlueprintPlanAuthorityBody(
    value: unknown
): BlueprintContractResult<BlueprintPlanAuthorityBodyV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'requestedSnapshot',
            'projectedSnapshot',
            'roleProjection',
            'mappings',
            'referenceAuthority',
            'blockers',
            'provenance',
        ])
    ) {
        return invalid('Blueprint plan authority body is malformed.');
    }
    const requestedSnapshot = normalizeBlueprintSnapshot(value.requestedSnapshot);
    const projectedSnapshot = normalizeBlueprintSnapshot(value.projectedSnapshot);
    if (requestedSnapshot.type === 'invalid' || projectedSnapshot.type === 'invalid') {
        return invalid('Blueprint plan authority snapshots are malformed.');
    }
    const roleProjection = normalizeRoleProjection(value.roleProjection);
    const mappings = normalizeMappings(value.mappings);
    const referenceAuthority = normalizeReferenceAuthority(value.referenceAuthority);
    const blockers = normalizeBlockers(value.blockers);
    const provenance = normalizeProvenance(value.provenance);
    if (!roleProjection || !mappings || !referenceAuthority || !blockers || !provenance) {
        return invalid('Blueprint plan authority contains malformed authority fields.');
    }
    if (
        provenance.requestedGuildId !== (requestedSnapshot.snapshot.guildId ?? null) ||
        provenance.requestedExportedAt !== (requestedSnapshot.snapshot.exportedAt ?? null)
    ) {
        return invalid('Blueprint plan authority provenance does not match its requested snapshot.');
    }
    return {
        type: 'valid',
        value: {
            requestedSnapshot: requestedSnapshot.snapshot,
            projectedSnapshot: projectedSnapshot.snapshot,
            roleProjection,
            mappings,
            referenceAuthority,
            blockers,
            provenance,
        },
    };
}

export function normalizeBlueprintPlanExecutionAuthority(
    value: unknown
): BlueprintContractResult<BlueprintPlanExecutionAuthorityV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'version',
            'planId',
            'guildId',
            'sourceGuildId',
            'sourceTargetMap',
            'knownTargetKinds',
            'initialIdMap',
            'contentDigest',
            'executionAuthorityDigest',
            'createdAt',
        ]) ||
        value.version !== BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION ||
        !isCanonicalText(value.planId) ||
        !isCanonicalText(value.guildId) ||
        (value.sourceGuildId !== undefined && !isCanonicalText(value.sourceGuildId)) ||
        !isSha256(value.contentDigest) ||
        !isSha256(value.executionAuthorityDigest) ||
        !isTimestamp(value.createdAt)
    ) {
        return invalid('Blueprint plan execution authority metadata is malformed.');
    }
    const body = normalizeBlueprintPlanExecutionAuthorityBody({
        sourceGuildId: value.sourceGuildId,
        sourceTargetMap: value.sourceTargetMap,
        knownTargetKinds: value.knownTargetKinds,
        initialIdMap: value.initialIdMap,
    });
    if (body.type === 'invalid') return body;
    if (body.value.knownTargetKinds[value.guildId] !== 'role') {
        return invalid('Blueprint plan execution authority target guild reference is malformed.');
    }
    return {
        type: 'valid',
        value: {
            version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
            planId: value.planId,
            guildId: value.guildId,
            ...body.value,
            contentDigest: value.contentDigest,
            executionAuthorityDigest: value.executionAuthorityDigest,
            createdAt: value.createdAt,
        },
    };
}

export function normalizeBlueprintPlanExecutionAuthorityManifest(
    value: unknown
): BlueprintContractResult<BlueprintPlanExecutionAuthorityManifestV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'version',
            'planId',
            'guildId',
            'sourceGuildId',
            'bucketCount',
            'contentDigest',
            'bucketDigests',
            'populatedBuckets',
            'executionAuthorityDigest',
            'createdAt',
        ]) ||
        value.version !== BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION ||
        !isCanonicalText(value.planId) ||
        !isCanonicalText(value.guildId) ||
        (value.sourceGuildId !== undefined && !isCanonicalText(value.sourceGuildId)) ||
        value.bucketCount !== BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT ||
        !isSha256(value.contentDigest) ||
        !Array.isArray(value.bucketDigests) ||
        value.bucketDigests.length !== BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT ||
        !value.bucketDigests.every(isSha256) ||
        !isSortedUniqueBucketArray(value.populatedBuckets) ||
        !isSha256(value.executionAuthorityDigest) ||
        !isTimestamp(value.createdAt)
    ) {
        return invalid('Blueprint plan execution authority manifest is malformed.');
    }
    return {
        type: 'valid',
        value: {
            version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
            planId: value.planId,
            guildId: value.guildId,
            ...(value.sourceGuildId === undefined ? {} : { sourceGuildId: value.sourceGuildId }),
            bucketCount: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT,
            contentDigest: value.contentDigest,
            bucketDigests: [...value.bucketDigests],
            populatedBuckets: value.populatedBuckets,
            executionAuthorityDigest: value.executionAuthorityDigest,
            createdAt: value.createdAt,
        },
    };
}

export function normalizeBlueprintPlanExecutionAuthorityBucket(
    value: unknown
): BlueprintContractResult<BlueprintPlanExecutionAuthorityBucketV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'version',
            'planId',
            'guildId',
            'bucket',
            'sourceTargetMap',
            'knownTargetKinds',
            'bucketDigest',
            'createdAt',
        ]) ||
        value.version !== BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION ||
        !isCanonicalText(value.planId) ||
        !isCanonicalText(value.guildId) ||
        !isSequence(value.bucket) ||
        value.bucket >= BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT ||
        !isSha256(value.bucketDigest) ||
        !isTimestamp(value.createdAt)
    ) {
        return invalid('Blueprint plan execution authority bucket metadata is malformed.');
    }
    const sourceTargetMap = normalizeStringMap(value.sourceTargetMap, true);
    const knownTargetKinds = normalizeKnownTargetKinds(value.knownTargetKinds);
    if (!sourceTargetMap || !knownTargetKinds) {
        return invalid('Blueprint plan execution authority bucket contents are malformed.');
    }
    return {
        type: 'valid',
        value: {
            version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
            planId: value.planId,
            guildId: value.guildId,
            bucket: value.bucket,
            sourceTargetMap,
            knownTargetKinds,
            bucketDigest: value.bucketDigest,
            createdAt: value.createdAt,
        },
    };
}

export function normalizeBlueprintPlanExecutionAuthorityBody(
    value: unknown
): BlueprintContractResult<BlueprintPlanExecutionAuthorityBodyV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['sourceGuildId', 'sourceTargetMap', 'knownTargetKinds', 'initialIdMap']) ||
        (value.sourceGuildId !== undefined && !isCanonicalText(value.sourceGuildId))
    ) {
        return invalid('Blueprint plan execution authority body is malformed.');
    }
    const reference = normalizeReferenceAuthority({
        sourceTargetMap: value.sourceTargetMap,
        knownTargetKinds: value.knownTargetKinds,
    });
    const initialIdMap = normalizeIdMap(value.initialIdMap);
    if (!reference || !initialIdMap || !isInitialIdMap(reference.sourceTargetMap, initialIdMap)) {
        return invalid('Blueprint plan execution reference authority is malformed.');
    }
    return {
        type: 'valid',
        value: {
            ...(value.sourceGuildId === undefined ? {} : { sourceGuildId: value.sourceGuildId }),
            ...reference,
            initialIdMap,
        },
    };
}

export function normalizeBlueprintPreflightEvidence(
    value: unknown
): BlueprintContractResult<BlueprintPreflightEvidenceV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'version',
            'preflightId',
            'planId',
            'report',
            'mutationFenceManifest',
            'reportDigest',
            'manifestDigest',
            'evidenceDigest',
            'createdAt',
        ]) ||
        value.version !== BLUEPRINT_PREFLIGHT_EVIDENCE_VERSION ||
        !isCanonicalText(value.preflightId) ||
        !isCanonicalText(value.planId) ||
        !isSha256(value.reportDigest) ||
        !isSha256(value.manifestDigest) ||
        !isSha256(value.evidenceDigest) ||
        !isTimestamp(value.createdAt)
    ) {
        return invalid('Blueprint preflight evidence metadata is malformed.');
    }
    const report = normalizeBlueprintPreflightReport(value.report);
    if (report.type === 'invalid') return invalid(report.message);
    let mutationFenceManifest: BlueprintMutationFenceManifestV2;
    try {
        mutationFenceManifest = parseBlueprintMutationFenceManifest(value.mutationFenceManifest);
    } catch {
        return invalid('Blueprint preflight mutation-fence evidence is malformed.');
    }
    return {
        type: 'valid',
        value: {
            version: BLUEPRINT_PREFLIGHT_EVIDENCE_VERSION,
            preflightId: value.preflightId,
            planId: value.planId,
            report: report.value,
            mutationFenceManifest,
            reportDigest: value.reportDigest,
            manifestDigest: value.manifestDigest,
            evidenceDigest: value.evidenceDigest,
            createdAt: value.createdAt,
        },
    };
}

export function normalizeBlueprintRunCursor(value: unknown): BlueprintContractResult<BlueprintRunCursorV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['version', 'runId', 'planId', 'idMap', 'updatedAt']) ||
        value.version !== BLUEPRINT_RUN_CURSOR_VERSION ||
        !isCanonicalText(value.runId) ||
        !isCanonicalText(value.planId) ||
        !isTimestamp(value.updatedAt)
    ) {
        return invalid('Blueprint run cursor metadata is malformed.');
    }
    const idMap = normalizeIdMap(value.idMap);
    if (!idMap) return invalid('Blueprint run cursor ID map is malformed.');
    return {
        type: 'valid',
        value: {
            version: BLUEPRINT_RUN_CURSOR_VERSION,
            runId: value.runId,
            planId: value.planId,
            idMap,
            updatedAt: value.updatedAt,
        },
    };
}

export function normalizeBlueprintRunVerificationEvidence(
    value: unknown
): BlueprintContractResult<BlueprintRunVerificationEvidenceV1> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'version',
            'runId',
            'planId',
            'verificationStatus',
            'result',
            'verificationEvidenceDigest',
            'createdAt',
        ]) ||
        value.version !== BLUEPRINT_RUN_VERIFICATION_EVIDENCE_VERSION ||
        !isCanonicalText(value.runId) ||
        !isCanonicalText(value.planId) ||
        !isVerificationStatus(value.verificationStatus) ||
        !isSha256(value.verificationEvidenceDigest) ||
        !isTimestamp(value.createdAt)
    ) {
        return invalid('Blueprint run verification evidence is malformed.');
    }
    const result = normalizeVerificationResult(value.result);
    if (result?.status !== value.verificationStatus) {
        return invalid('Blueprint run verification evidence result is malformed.');
    }
    return {
        type: 'valid',
        value: {
            version: BLUEPRINT_RUN_VERIFICATION_EVIDENCE_VERSION,
            runId: value.runId,
            planId: value.planId,
            verificationStatus: value.verificationStatus,
            result,
            verificationEvidenceDigest: value.verificationEvidenceDigest,
            createdAt: value.createdAt,
        },
    };
}

function normalizeMappings(value: unknown): BlueprintPlanMappings | undefined {
    if (!isRecord(value) || !hasOnlyKeys(value, ['roles', 'categories', 'channels'])) return undefined;
    const roles = normalizeStringMap(value.roles, false);
    const categories = normalizeStringMap(value.categories, false);
    const channels = normalizeStringMap(value.channels, false);
    return roles && categories && channels ? { roles, categories, channels } : undefined;
}

function normalizeReferenceAuthority(value: unknown): BlueprintPlanReferenceAuthorityV1 | undefined {
    if (!isRecord(value) || !hasOnlyKeys(value, ['sourceTargetMap', 'knownTargetKinds'])) return undefined;
    const sourceTargetMap = normalizeStringMap(value.sourceTargetMap, true);
    const knownTargetKinds = normalizeKnownTargetKinds(value.knownTargetKinds);
    if (!sourceTargetMap || !knownTargetKinds) return undefined;
    const targetIds = new Set<string>();
    for (const targetId of Object.values(sourceTargetMap)) {
        if (targetId === null) continue;
        if (!Object.hasOwn(knownTargetKinds, targetId) || targetIds.has(targetId)) return undefined;
        targetIds.add(targetId);
    }
    return { sourceTargetMap, knownTargetKinds };
}

function normalizeRoleProjection(value: unknown): BlueprintRoleProjection | undefined {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['version', 'mode', 'roles', 'skippedProtectedSourceIds', 'retainedProtectedTargetIds']) ||
        value.version !== 2 ||
        (value.mode !== 'merge' && value.mode !== 'synchronize' && value.mode !== 'rebuild') ||
        !Array.isArray(value.roles) ||
        value.roles.length > maximumLedgerEntries ||
        !isUniqueTextArray(value.skippedProtectedSourceIds) ||
        !isUniqueTextArray(value.retainedProtectedTargetIds)
    ) {
        return undefined;
    }
    if (
        value.roles.some(
            (role) =>
                !isRecord(role) ||
                !hasOnlyKeys(role, [
                    'logicalId',
                    'sourceId',
                    'targetId',
                    'name',
                    'hierarchyRank',
                    'position',
                    'disposition',
                    'protected',
                ]) ||
                !isCanonicalText(role.logicalId) ||
                (role.sourceId !== undefined && !isCanonicalText(role.sourceId)) ||
                (role.targetId !== undefined && !isCanonicalText(role.targetId)) ||
                !isCanonicalText(role.name) ||
                !isSequence(role.hierarchyRank) ||
                !isSequence(role.position) ||
                (role.disposition !== 'matched' && role.disposition !== 'create' && role.disposition !== 'retained') ||
                (role.protected !== undefined && role.protected !== true)
        )
    ) {
        return undefined;
    }
    return value as BlueprintRoleProjection;
}

function normalizeBlockers(value: unknown): BlueprintPlanBlocker[] | undefined {
    if (!Array.isArray(value) || value.length > maximumLedgerEntries) return undefined;
    if (
        value.some(
            (entry) =>
                !isRecord(entry) ||
                !hasOnlyKeys(entry, ['code', 'targetType', 'sourceId', 'targetId', 'fields']) ||
                entry.code !== 'unsupported-field-change' ||
                (entry.targetType !== 'category' && entry.targetType !== 'channel') ||
                !isCanonicalText(entry.sourceId) ||
                !isCanonicalText(entry.targetId) ||
                !Array.isArray(entry.fields) ||
                entry.fields.some((field) => field !== 'type' && field !== 'url')
        )
    ) {
        return undefined;
    }
    return value as BlueprintPlanBlocker[];
}

function normalizeProvenance(value: unknown): BlueprintPlanAuthorityProvenanceV1 | undefined {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'source',
            'requestedGuildId',
            'requestedExportedAt',
            'requestedSnapshotStoredAt',
            'sourcePlanId',
            'sourceRunId',
        ]) ||
        (value.source !== 'dashboard-json' &&
            value.source !== 'backup' &&
            value.source !== 'dashboard-recovery-plan') ||
        (value.requestedGuildId !== null && !isCanonicalText(value.requestedGuildId)) ||
        (value.requestedExportedAt !== null && !isCanonicalText(value.requestedExportedAt)) ||
        !isTimestamp(value.requestedSnapshotStoredAt) ||
        (value.sourcePlanId !== undefined && !isCanonicalText(value.sourcePlanId)) ||
        (value.sourceRunId !== undefined && !isCanonicalText(value.sourceRunId))
    ) {
        return undefined;
    }
    return value as BlueprintPlanAuthorityProvenanceV1;
}

function normalizeKnownTargetKinds(value: unknown): Record<string, BlueprintEntityKind> | undefined {
    if (!isRecord(value)) return undefined;
    const entries: Array<[string, BlueprintEntityKind]> = [];
    for (const [id, kind] of Object.entries(value)) {
        if (!isCanonicalText(id) || typeof kind !== 'string' || !entityKinds.has(kind as BlueprintEntityKind)) {
            return undefined;
        }
        entries.push([id, kind as BlueprintEntityKind]);
    }
    return Object.fromEntries(entries);
}

function normalizeIdMap(value: unknown): Record<string, string> | undefined {
    const normalized = normalizeStringMap(value, false);
    if (!normalized) return undefined;
    const targets = Object.values(normalized);
    return new Set(targets).size === targets.length ? normalized : undefined;
}

function normalizeStringMap(value: unknown, allowNull: false): Record<string, string> | undefined;
function normalizeStringMap(value: unknown, allowNull: true): Record<string, string | null> | undefined;
function normalizeStringMap(value: unknown, allowNull: boolean): Record<string, string | null> | undefined {
    if (!isRecord(value)) return undefined;
    const entries: Array<[string, string | null]> = [];
    for (const [key, item] of Object.entries(value)) {
        if (!isCanonicalText(key) || (item !== null && !isCanonicalText(item)) || (item === null && !allowNull)) {
            return undefined;
        }
        entries.push([key, item]);
    }
    return Object.fromEntries(entries);
}

function isInitialIdMap(sourceTargetMap: Record<string, string | null>, initialIdMap: Record<string, string>): boolean {
    const expected = Object.fromEntries(
        Object.entries(sourceTargetMap).filter((entry): entry is [string, string] => entry[1] !== null)
    );
    return (
        Object.keys(expected).length === Object.keys(initialIdMap).length &&
        Object.entries(expected).every(([key, value]) => initialIdMap[key] === value)
    );
}

function isUniqueTextArray(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.length <= maximumLedgerEntries &&
        value.every(isCanonicalText) &&
        new Set(value).size === value.length
    );
}

function isSortedUniqueBucketArray(value: unknown): value is number[] {
    return (
        Array.isArray(value) &&
        value.every(
            (bucket, index) =>
                isSequence(bucket) &&
                bucket < BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT &&
                bucket > (value[index - 1] ?? -1)
        )
    );
}

function normalizeVerificationResult(value: unknown): BlueprintVerificationResult | undefined {
    if (!isRecord(value) || value.version !== 1 || !isVerificationStatus(value.status)) return undefined;
    if (value.status === 'matched' || value.status === 'mismatch') {
        if (
            !hasOnlyKeys(value, ['version', 'status', 'expectedStructureDigest', 'actualStructureDigest']) ||
            !isSha256(value.expectedStructureDigest) ||
            !isSha256(value.actualStructureDigest) ||
            (value.status === 'matched') !== (value.expectedStructureDigest === value.actualStructureDigest)
        ) {
            return undefined;
        }
        return {
            version: 1,
            status: value.status,
            expectedStructureDigest: value.expectedStructureDigest,
            actualStructureDigest: value.actualStructureDigest,
        };
    }
    if (!hasOnlyKeys(value, ['version', 'status', 'reason']) || !isVerificationReadFailureReason(value.reason)) {
        return undefined;
    }
    return { version: 1, status: 'read_failed', reason: value.reason };
}

function isVerificationReadFailureReason(
    value: unknown
): value is Extract<BlueprintVerificationResult, { status: 'read_failed' }>['reason'] {
    return (
        value === 'provider-read-failed' ||
        value === 'projected-snapshot-invalid' ||
        value === 'verification-evidence-invalid' ||
        value === 'verification-evidence-too-large'
    );
}

function isVerificationStatus(value: unknown): value is BlueprintVerificationStatus {
    return value === 'matched' || value === 'mismatch' || value === 'read_failed';
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
    return isCanonicalText(value) && Number.isFinite(Date.parse(value));
}

function isSequence(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid<T>(message: string): BlueprintContractResult<T> {
    return { type: 'invalid', message };
}
