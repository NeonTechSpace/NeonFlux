import { v, type GenericId } from 'convex/values';
import {
    BLUEPRINT_MUTATION_FENCE_VERSION,
    compareBlueprintMutationFenceManifests,
    createBlueprintMutationFenceManifest,
    parseBlueprintMutationFenceManifest,
} from '@neonflux/blueprint/mutation-fence';
import { normalizeBlueprintSnapshot, toPortableBlueprintRestoreSnapshot } from '@neonflux/blueprint/snapshot';
import {
    createBlueprintPreflightDigest,
    createBlueprintRestorePointSnapshotDigest,
    validateBlueprintPreflightEvidenceIntegrity,
} from '@neonflux/blueprint/integrity';
import { mutation, type MutationCtx } from '../_generated/server.js';
import type { Doc } from '../_generated/dataModel.js';
import { requireNeonFluxService } from '../auth.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import {
    createBlueprintRunTerminalSourceDigest,
    finalizeBlueprintRunInMutation,
} from './blueprint_run_terminal_mutation.js';
import { patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import {
    buildBlueprintArtifact,
    loadStructureBackupArtifact,
    persistStructureBackupArtifactChunks,
} from './blueprint_artifact_persistence.js';
import { assertBlueprintRunRestoreObservationManifest } from './blueprint_run_restore.js';
import { assertCurrentBlueprintRunProtocol } from './blueprint_run_protocol.js';
import {
    isBlueprintRunMutationAuthorizedForLease,
    resolveBlueprintRunAuthorizationDecision,
} from './blueprint_run_model.js';
import { buildBackupSortCursor, buildStructureBackupDocument } from './structure_backup_model.js';
import { requireRunLease } from './blueprint_run_lease.js';
import { blueprintRunMutationAuthorizationRecordValidator, toHotRunRecord } from './blueprint_contract_validators.js';

export const authorizeBlueprintRunMutation = mutation({
    args: {
        fingerprintVersion: v.literal(BLUEPRINT_MUTATION_FENCE_VERSION),
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        manifestJson: v.string(),
        now: v.string(),
        observedAt: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        structureJson: v.string(),
    },
    returns: blueprintRunMutationAuthorizationRecordValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await ctx.db.get('blueprintRuns', args.runId);
        if (!run) throw new Error('blueprint-run-not-found');
        assertCurrentBlueprintRunProtocol(run);
        if (
            run.status !== 'running' ||
            run.leaseId !== args.leaseId ||
            run.leaseOwner !== args.leaseOwner ||
            !run.leaseExpiresAt ||
            run.leaseExpiresAt < args.now
        ) {
            throw new Error('blueprint-run-lease-lost');
        }
        if (!run.restorePointBackupId || !run.restorePointSnapshotDigest) {
            throw new Error('blueprint-run-restore-point-required');
        }
        const restoreObservation = await validateBlueprintRunRestorePoint(ctx, run);
        if (
            isBlueprintRunMutationAuthorizedForLease({
                completedMutationSteps: run.completedMutationSteps,
                expiresAt: run.preflightExpiresAt,
                leaseId: args.leaseId,
                ...(run.mutationAuthorizedAt ? { mutationAuthorizedAt: run.mutationAuthorizedAt } : {}),
                ...(run.mutationAuthorizationLeaseId
                    ? { mutationAuthorizationLeaseId: run.mutationAuthorizationLeaseId }
                    : {}),
                nextStepSequence: run.nextStepSequence,
                now: args.now,
            })
        ) {
            return { kind: 'not_required' as const, run: toHotRunRecord(run) };
        }
        const snapshotValue = parseJsonRecord(args.structureJson, 'blueprint-run-authorization-snapshot-invalid');
        const normalizedSnapshot = normalizeBlueprintSnapshot(snapshotValue);
        if (normalizedSnapshot.type === 'invalid') throw new Error('blueprint-run-authorization-snapshot-invalid');
        const suppliedManifest = parseBlueprintMutationFenceManifest(
            parseJsonRecord(args.manifestJson, 'blueprint-run-authorization-manifest-invalid')
        );
        const actualManifest = await createBlueprintMutationFenceManifest(normalizedSnapshot.snapshot);
        if (
            suppliedManifest.structureDigest !== actualManifest.structureDigest ||
            suppliedManifest.capabilityDigest !== actualManifest.capabilityDigest ||
            suppliedManifest.guildId !== run.guildId
        ) {
            throw new Error('blueprint-run-authorization-manifest-invalid');
        }
        const restoreManifest = parseBlueprintMutationFenceManifest(
            parseJsonRecord(restoreObservation.manifestJson, 'blueprint-run-restore-observation-invalid')
        );
        const preflight = await ctx.db.get('blueprintPlanPreflights', run.preflightId);
        if (
            preflight?.planId !== run.planId ||
            preflight.guildId !== run.guildId ||
            preflight.preflightDigest !== run.preflightDigest ||
            preflight.expiresAt !== run.preflightExpiresAt
        ) {
            throw new Error('blueprint-run-preflight-missing');
        }
        const preflightEvidence = await ctx.db
            .query('blueprintPlanPreflightEvidence')
            .withIndex('by_preflight', (q) => q.eq('preflightId', preflight._id))
            .unique();
        if (!preflightEvidence) throw new Error('blueprint-run-preflight-missing');
        const evidenceIntegrity = await validateBlueprintPreflightEvidenceIntegrity(
            stripConvexMetadata(preflightEvidence)
        );
        if (
            evidenceIntegrity.type === 'invalid' ||
            evidenceIntegrity.value.preflightId !== String(preflight._id) ||
            evidenceIntegrity.value.planId !== String(run.planId) ||
            evidenceIntegrity.value.evidenceDigest !== preflight.evidenceDigest
        ) {
            throw new Error('blueprint-run-preflight-evidence-invalid');
        }
        const expectedPreflightDigest = await createBlueprintPreflightDigest({
            planId: String(run.planId),
            planDigest: preflight.planDigest,
            status: preflight.status,
            checkedAt: preflight.checkedAt,
            observedAt: preflight.observedAt,
            expiresAt: preflight.expiresAt,
            fingerprintVersion: preflight.fingerprintVersion,
            structureFingerprint: preflight.structureFingerprint,
            capabilityFingerprint: preflight.capabilityFingerprint,
            evidenceDigest: preflight.evidenceDigest,
        });
        if (expectedPreflightDigest !== preflight.preflightDigest) {
            throw new Error('blueprint-run-preflight-digest-invalid');
        }
        const expectedManifest = parseBlueprintMutationFenceManifest(preflightEvidence.mutationFenceManifest);
        const restoreComparison = compareBlueprintMutationFenceManifests(restoreManifest, actualManifest);
        const expectedComparison = compareBlueprintMutationFenceManifests(expectedManifest, actualManifest);
        const rejectionReason = resolveBlueprintRunAuthorizationDecision({
            capabilityChanged: expectedComparison.capabilityChanged,
            fingerprintVersionsCurrent: areBlueprintFingerprintVersionsCurrent(
                run.fingerprintVersion,
                preflight.fingerprintVersion,
                args.fingerprintVersion
            ),
            now: args.now,
            preflightExpiresAt: run.preflightExpiresAt,
            restoreObservationEqual: restoreComparison.equal,
            structureChanged: expectedComparison.structureChanged,
        });
        const existingAuthorizationObservation = await ctx.db
            .query('blueprintRunObservations')
            .withIndex('by_run_phase', (q) => q.eq('runId', run._id).eq('phase', 'authorization'))
            .unique();
        const authorizationObservation = {
            capabilityFingerprint: actualManifest.capabilityDigest,
            fingerprintVersion: args.fingerprintVersion,
            guildId: run.guildId,
            manifestJson: JSON.stringify(actualManifest),
            observedAt: args.observedAt,
            phase: 'authorization' as const,
            runId: run._id,
            source: 'token-client' as const,
            structureFingerprint: actualManifest.structureDigest,
        };
        if (existingAuthorizationObservation) {
            await ctx.db.patch(
                'blueprintRunObservations',
                existingAuthorizationObservation._id,
                authorizationObservation
            );
        } else {
            await ctx.db.insert('blueprintRunObservations', authorizationObservation);
        }
        if (rejectionReason) {
            const mismatch =
                rejectionReason === 'restore_observation_diverged' ? restoreComparison : expectedComparison;
            const observationPatch = {
                authorizationDecision: rejectionReason,
                authorizationMismatchJson: JSON.stringify(mismatch),
                updatedAt: args.now,
            };
            await patchBlueprintRunChecked(ctx, run, observationPatch);
            const patch = await finalizeBlueprintRunInMutation(ctx, {
                errorType: authorizationErrorType(rejectionReason),
                run,
                now: args.now,
                status: 'failed_before_mutation',
                terminalRequestSourceDigest: await createBlueprintRunTerminalSourceDigest({
                    kind: 'authorization_rejection',
                    identity: { actualManifest, rejectionReason },
                }),
            });
            return {
                kind: 'rejected' as const,
                reason: rejectionReason,
                run: toHotRunRecord({ ...run, ...observationPatch, ...patch }),
            };
        }
        const authorizationPatch = {
            authorizationDecision: 'authorized' as const,
            authorizationMismatchJson: undefined,
            mutationAuthorizedAt: args.now,
            mutationAuthorizationLeaseId: args.leaseId,
            updatedAt: args.now,
        };
        await patchBlueprintRunChecked(ctx, run, authorizationPatch);
        return {
            kind: 'authorized' as const,
            run: toHotRunRecord({ ...run, ...authorizationPatch }),
        };
    },
});

export const ensureBlueprintRunRestorePoint = mutation({
    args: {
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        observedAt: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        structureJson: v.string(),
    },
    returns: v.object({ backupId: v.string(), snapshotDigest: v.string() }),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await requireRunLease(ctx, args.runId, args.leaseId, args.leaseOwner, args.now, ['running']);
        const snapshotValue = parseJsonRecord(args.structureJson, 'structure-restore-point-json-invalid');
        const normalizedSnapshot = normalizeBlueprintSnapshot(snapshotValue);
        if (normalizedSnapshot.type === 'invalid' || normalizedSnapshot.snapshot.guildId !== run.guildId) {
            throw new Error('blueprint-run-restore-observation-invalid');
        }
        const manifest = await createBlueprintMutationFenceManifest(normalizedSnapshot.snapshot);
        const portableSnapshot = toPortableBlueprintRestoreSnapshot(normalizedSnapshot.snapshot);
        const snapshotDigest = await createBlueprintRestorePointSnapshotDigest(portableSnapshot);
        if (run.restorePointBackupId) {
            await validateBlueprintRunRestorePoint(ctx, run, {
                expectedManifest: manifest,
                expectedSnapshotDigest: snapshotDigest,
            });
            return { backupId: run.restorePointBackupId, snapshotDigest };
        }
        const built = buildStructureBackupDocument(
            {
                createdAt: args.now,
                guildId: run.guildId,
                sortKey: buildBackupSortCursor({ createdAt: args.now, id: crypto.randomUUID() }),
                source: 'restore_point',
                status: 'succeeded',
                structure: portableSnapshot,
            },
            args.now
        );
        if (!built.ok) throw new Error('structure-restore-point-invalid');
        const { structure, ...metadata } = built.value;
        if (!structure) throw new Error('structure-restore-point-invalid');
        const artifact = await buildBlueprintArtifact(structure);
        const backupId = await ctx.db.insert('structureBackups', { ...metadata, ...artifact.manifest });
        await persistStructureBackupArtifactChunks(ctx, {
            artifact,
            backupId,
            createdAt: args.now,
            guildId: run.guildId,
        });
        await ctx.db.insert('blueprintRunObservations', {
            capabilityFingerprint: manifest.capabilityDigest,
            fingerprintVersion: BLUEPRINT_MUTATION_FENCE_VERSION,
            guildId: run.guildId,
            manifestJson: JSON.stringify(manifest),
            observedAt: args.observedAt,
            phase: 'restore',
            restorePointBackupId: backupId,
            restorePointSnapshotDigest: snapshotDigest,
            runId: run._id,
            source: 'token-client',
            structureFingerprint: manifest.structureDigest,
        });
        await patchBlueprintRunChecked(ctx, run, {
            restorePointBackupId: String(backupId),
            restorePointSnapshotDigest: snapshotDigest,
            updatedAt: args.now,
        });
        return { backupId: String(backupId), snapshotDigest };
    },
});

async function validateBlueprintRunRestorePoint(
    ctx: MutationCtx,
    run: Doc<'blueprintRuns'>,
    input: {
        expectedManifest?: ReturnType<typeof parseBlueprintMutationFenceManifest>;
        expectedSnapshotDigest?: string;
    } = {}
): Promise<Doc<'blueprintRunObservations'>> {
    if (!run.restorePointBackupId || !run.restorePointSnapshotDigest) {
        throw new Error('blueprint-run-restore-point-required');
    }
    const backupId = run.restorePointBackupId as GenericId<'structureBackups'>;
    const [backup, observation] = await Promise.all([
        ctx.db.get('structureBackups', backupId),
        ctx.db
            .query('blueprintRunObservations')
            .withIndex('by_run_phase', (q) => q.eq('runId', run._id).eq('phase', 'restore'))
            .unique(),
    ]);
    const observationManifestJson = observation?.manifestJson;
    if (
        backup?.guildId !== run.guildId ||
        backup.source !== 'restore_point' ||
        backup.status !== 'succeeded' ||
        observation?.guildId !== run.guildId ||
        observation.restorePointBackupId !== backupId ||
        observation.restorePointSnapshotDigest !== run.restorePointSnapshotDigest ||
        !observationManifestJson
    ) {
        throw new Error('blueprint-run-restore-point-invalid');
    }
    const backupStructure = await loadStructureBackupArtifact(ctx, backup);
    const normalized = normalizeBlueprintSnapshot(backupStructure);
    if (normalized.type === 'invalid' || normalized.snapshot.guildId !== run.guildId) {
        throw new Error('blueprint-run-restore-point-invalid');
    }
    const digest = await createBlueprintRestorePointSnapshotDigest(normalized.snapshot);
    if (
        digest !== run.restorePointSnapshotDigest ||
        (input.expectedSnapshotDigest !== undefined && digest !== input.expectedSnapshotDigest)
    ) {
        throw new Error('blueprint-run-restore-point-invalid');
    }
    const manifest = parseBlueprintMutationFenceManifest(
        parseJsonRecord(observationManifestJson, 'blueprint-run-restore-observation-invalid')
    );
    assertBlueprintRunRestoreObservationManifest({
        ...(input.expectedManifest ? { expectedManifest: input.expectedManifest } : {}),
        guildId: run.guildId,
        manifest,
        observationCapabilityFingerprint: observation.capabilityFingerprint,
        observationStructureFingerprint: observation.structureFingerprint,
    });
    return observation;
}

function parseJsonRecord(value: string, errorType: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // The stable domain error below is the only parse detail callers need.
    }
    throw new Error(errorType);
}

function areBlueprintFingerprintVersionsCurrent(...versions: readonly number[]): boolean {
    return versions.every((version) => version === BLUEPRINT_MUTATION_FENCE_VERSION);
}

function authorizationErrorType(
    reason:
        | 'preflight_expired'
        | 'structure_changed'
        | 'capability_changed'
        | 'structure_and_capability_changed'
        | 'restore_observation_diverged'
        | 'fingerprint_version_mismatch'
): string {
    switch (reason) {
        case 'preflight_expired':
            return 'preflight-expired-before-mutation';
        case 'structure_changed':
            return 'live-structure-changed-before-mutation';
        case 'capability_changed':
            return 'bot-capability-changed-before-mutation';
        case 'structure_and_capability_changed':
            return 'live-structure-and-capability-changed-before-mutation';
        case 'restore_observation_diverged':
            return 'restore-observation-diverged-before-mutation';
        case 'fingerprint_version_mismatch':
            return 'fingerprint-version-mismatch-before-mutation';
    }
}

function stripConvexMetadata<T extends { _id: unknown; _creationTime: unknown }>(
    value: T
): Omit<T, '_id' | '_creationTime'> {
    const { _id: ignoredId, _creationTime: ignoredCreationTime, ...document } = value;
    void ignoredId;
    void ignoredCreationTime;
    return document;
}
