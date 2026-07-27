import { v, type GenericValidator } from 'convex/values';
import { normalizeBlueprintPlanDecision, normalizeBlueprintPlanStep } from '@neonflux/blueprint/runtime-contracts';
import type {
    BlueprintPlanAuthorityV1,
    BlueprintPlanExecutionAuthorityV1,
} from '@neonflux/blueprint/persisted-authority';

import type { Doc } from '../_generated/dataModel.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { hotRunRecordValidator, planMetadataRecordValidator, toHotRunRecord } from './blueprint_hot_records.js';

const entityKindValidator = v.union(v.literal('role'), v.literal('category'), v.literal('channel'));
const actionTypeValidator = v.union(v.literal('create'), v.literal('update'), v.literal('delete'));
const targetTypeValidator = v.union(
    v.literal('role'),
    v.literal('category'),
    v.literal('channel'),
    v.literal('role-order'),
    v.literal('channel-order')
);
const providerOperationValidator = v.union(
    v.literal('create'),
    v.literal('delete'),
    v.literal('update'),
    v.literal('update-metadata'),
    v.literal('update-placement'),
    v.literal('channel-order'),
    v.literal('role-order'),
    v.literal('permission-overwrite-delete'),
    v.literal('permission-overwrite-upsert')
);
const providerMetadataValidator = v.object({
    groupId: v.string(),
    operation: providerOperationValidator,
    step: v.number(),
    stepCount: v.number(),
});
const optionalProviderFields = {
    mutationSteps: v.optional(v.literal(1)),
    provider: v.optional(providerMetadataValidator),
};

const roleValidator = v.object({
    color: v.number(),
    hierarchyRank: v.optional(v.number()),
    hoist: v.boolean(),
    id: v.string(),
    mentionable: v.boolean(),
    name: v.string(),
    permissions: v.string(),
    position: v.number(),
    protected: v.optional(v.boolean()),
    protectionReason: v.optional(
        v.union(v.literal('everyone'), v.literal('bot'), v.literal('integration'), v.literal('managed'))
    ),
});
const permissionOverwriteValidator = v.object({
    allow: v.string(),
    deny: v.string(),
    id: v.string(),
    type: v.number(),
});
const channelValidator = v.object({
    id: v.string(),
    name: v.union(v.string(), v.null()),
    parentId: v.union(v.string(), v.null()),
    permissionOverwrites: v.array(permissionOverwriteValidator),
    position: v.union(v.number(), v.null()),
    type: v.number(),
    url: v.optional(v.union(v.string(), v.null())),
});
export const blueprintSnapshotValidator = v.object({
    botHighestRoleHierarchyRank: v.optional(v.number()),
    botHighestRolePosition: v.optional(v.number()),
    categories: v.array(channelValidator),
    channels: v.array(channelValidator),
    exportedAt: v.optional(v.string()),
    guildId: v.optional(v.string()),
    guildName: v.optional(v.string()),
    roles: v.array(roleValidator),
    version: v.literal(1),
});
const roleProjectionValidator = v.object({
    mode: v.union(v.literal('merge'), v.literal('synchronize'), v.literal('rebuild')),
    retainedProtectedTargetIds: v.array(v.string()),
    roles: v.array(
        v.object({
            disposition: v.union(v.literal('matched'), v.literal('create'), v.literal('retained')),
            hierarchyRank: v.number(),
            logicalId: v.string(),
            name: v.string(),
            position: v.number(),
            protected: v.optional(v.boolean()),
            sourceId: v.optional(v.string()),
            targetId: v.optional(v.string()),
        })
    ),
    skippedProtectedSourceIds: v.array(v.string()),
    version: v.literal(2),
});
const mappingsValidator = v.object({
    categories: v.record(v.string(), v.string()),
    channels: v.record(v.string(), v.string()),
    roles: v.record(v.string(), v.string()),
});
const blockerValidator = v.object({
    code: v.literal('unsupported-field-change'),
    fields: v.array(v.union(v.literal('type'), v.literal('url'))),
    sourceId: v.string(),
    targetId: v.string(),
    targetType: v.union(v.literal('category'), v.literal('channel')),
});

export const blueprintPlanAuthorityRecordValidator = v.object({
    authorityDigest: v.string(),
    blockers: v.array(blockerValidator),
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    mappings: mappingsValidator,
    planId: v.string(),
    projectedSnapshot: blueprintSnapshotValidator,
    provenance: v.object({
        requestedExportedAt: v.union(v.string(), v.null()),
        requestedGuildId: v.union(v.string(), v.null()),
        requestedSnapshotStoredAt: v.string(),
        source: v.union(v.literal('dashboard-json'), v.literal('backup'), v.literal('dashboard-recovery-plan')),
        sourcePlanId: v.optional(v.string()),
        sourceRunId: v.optional(v.string()),
    }),
    referenceAuthority: v.object({
        knownTargetKinds: v.record(v.string(), entityKindValidator),
        sourceTargetMap: v.record(v.string(), v.union(v.string(), v.null())),
    }),
    requestedSnapshot: blueprintSnapshotValidator,
    roleProjection: roleProjectionValidator,
    version: v.literal(1),
});

export const blueprintPlanAuthorityValidator = v.object({
    authorityDigest: v.string(),
    blockers: v.array(blockerValidator),
    createdAt: v.string(),
    guildId: v.string(),
    mappings: mappingsValidator,
    planId: v.string(),
    projectedSnapshot: blueprintSnapshotValidator,
    provenance: v.object({
        requestedExportedAt: v.union(v.string(), v.null()),
        requestedGuildId: v.union(v.string(), v.null()),
        requestedSnapshotStoredAt: v.string(),
        source: v.union(v.literal('dashboard-json'), v.literal('backup'), v.literal('dashboard-recovery-plan')),
        sourcePlanId: v.optional(v.string()),
        sourceRunId: v.optional(v.string()),
    }),
    referenceAuthority: v.object({
        knownTargetKinds: v.record(v.string(), entityKindValidator),
        sourceTargetMap: v.record(v.string(), v.union(v.string(), v.null())),
    }),
    requestedSnapshot: blueprintSnapshotValidator,
    roleProjection: roleProjectionValidator,
    version: v.literal(1),
});

export const blueprintPlanAuthorityDraftValidator = v.object({
    authorityDigest: v.string(),
    blockers: v.array(blockerValidator),
    guildId: v.string(),
    mappings: mappingsValidator,
    projectedSnapshot: blueprintSnapshotValidator,
    provenance: v.object({
        requestedExportedAt: v.union(v.string(), v.null()),
        requestedGuildId: v.union(v.string(), v.null()),
        requestedSnapshotStoredAt: v.string(),
        source: v.union(v.literal('dashboard-json'), v.literal('backup'), v.literal('dashboard-recovery-plan')),
        sourcePlanId: v.optional(v.string()),
        sourceRunId: v.optional(v.string()),
    }),
    referenceAuthority: v.object({
        knownTargetKinds: v.record(v.string(), entityKindValidator),
        sourceTargetMap: v.record(v.string(), v.union(v.string(), v.null())),
    }),
    requestedSnapshot: blueprintSnapshotValidator,
    roleProjection: roleProjectionValidator,
    version: v.literal(1),
});

export const blueprintPlanExecutionAuthorityRecordValidator = v.object({
    contentDigest: v.string(),
    createdAt: v.string(),
    executionAuthorityDigest: v.string(),
    guildId: v.string(),
    id: v.string(),
    initialIdMap: v.record(v.string(), v.string()),
    knownTargetKinds: v.record(v.string(), entityKindValidator),
    planId: v.string(),
    sourceGuildId: v.optional(v.string()),
    sourceTargetMap: v.record(v.string(), v.union(v.string(), v.null())),
    version: v.literal(1),
});
export const blueprintPlanExecutionAuthorityDraftValidator = v.object({
    contentDigest: v.string(),
    executionAuthorityDigest: v.string(),
    guildId: v.string(),
    initialIdMap: v.record(v.string(), v.string()),
    knownTargetKinds: v.record(v.string(), entityKindValidator),
    sourceGuildId: v.optional(v.string()),
    sourceTargetMap: v.record(v.string(), v.union(v.string(), v.null())),
    version: v.literal(1),
});

const roleStringChangeValidator = v.object({
    after: v.string(),
    before: v.optional(v.string()),
    field: v.union(v.literal('name'), v.literal('permissions')),
});
const roleNumberChangeValidator = v.object({
    after: v.number(),
    before: v.optional(v.number()),
    field: v.literal('color'),
});
const roleBooleanChangeValidator = v.object({
    after: v.boolean(),
    before: v.optional(v.boolean()),
    field: v.union(v.literal('hoist'), v.literal('mentionable')),
});
const roleChangeValidator = v.union(roleStringChangeValidator, roleNumberChangeValidator, roleBooleanChangeValidator);
const channelTextChangeValidator = v.object({
    after: v.union(v.string(), v.null()),
    before: v.optional(v.union(v.string(), v.null())),
    field: v.union(v.literal('name'), v.literal('parentId')),
});
const channelPositionChangeValidator = v.object({
    after: v.union(v.number(), v.null()),
    before: v.optional(v.union(v.number(), v.null())),
    field: v.literal('position'),
});
const channelOverwriteChangeValidator = v.object({
    after: v.array(permissionOverwriteValidator),
    before: v.optional(v.array(permissionOverwriteValidator)),
    field: v.literal('permissionOverwrites'),
});
const channelChangeValidator = v.union(
    channelTextChangeValidator,
    channelPositionChangeValidator,
    channelOverwriteChangeValidator
);
const roleOrderEntryValidator = v.object({
    hierarchyRank: v.optional(v.number()),
    position: v.number(),
    sourceId: v.string(),
});
const channelOrderEntryValidator = v.object({
    parentSourceId: v.union(v.string(), v.null()),
    position: v.number(),
    sourceId: v.string(),
});

function createStepValidator<
    const TTarget extends 'role' | 'category' | 'channel',
    TEntityValidator extends GenericValidator,
>(targetType: TTarget, entityValidator: TEntityValidator) {
    return v.object({
        actionType: v.literal('create'),
        details: v.object({
            after: entityValidator,
            label: v.string(),
            ...optionalProviderFields,
        }),
        label: v.string(),
        targetId: v.string(),
        targetType: v.literal(targetType),
    });
}

function deleteStepValidator<
    const TTarget extends 'role' | 'category' | 'channel',
    TEntityValidator extends GenericValidator,
>(targetType: TTarget, entityValidator: TEntityValidator) {
    return v.object({
        actionType: v.literal('delete'),
        details: v.object({
            before: entityValidator,
            label: v.string(),
            ...optionalProviderFields,
        }),
        label: v.string(),
        targetId: v.string(),
        targetType: v.literal(targetType),
    });
}

function channelUpdateStepValidator<const TTarget extends 'category' | 'channel'>(targetType: TTarget) {
    return v.object({
        actionType: v.literal('update'),
        details: v.object({
            changes: v.array(channelChangeValidator),
            label: v.string(),
            ...optionalProviderFields,
        }),
        label: v.string(),
        targetId: v.string(),
        targetType: v.literal(targetType),
    });
}

export const blueprintPlanStepValidator = v.union(
    createStepValidator('role', roleValidator),
    v.object({
        actionType: v.literal('update'),
        details: v.object({
            changes: v.array(roleChangeValidator),
            label: v.string(),
            ...optionalProviderFields,
            sourceId: v.optional(v.string()),
        }),
        label: v.string(),
        targetId: v.string(),
        targetType: v.literal('role'),
    }),
    deleteStepValidator('role', roleValidator),
    createStepValidator('category', channelValidator),
    channelUpdateStepValidator('category'),
    deleteStepValidator('category', channelValidator),
    createStepValidator('channel', channelValidator),
    channelUpdateStepValidator('channel'),
    deleteStepValidator('channel', channelValidator),
    v.object({
        actionType: v.literal('update'),
        details: v.object({
            after: v.array(roleOrderEntryValidator),
            changes: v.array(
                v.object({
                    after: v.array(roleOrderEntryValidator),
                    before: v.optional(v.array(roleOrderEntryValidator)),
                    field: v.literal('roleOrder'),
                })
            ),
            label: v.string(),
            ...optionalProviderFields,
        }),
        label: v.string(),
        targetId: v.string(),
        targetType: v.literal('role-order'),
    }),
    v.object({
        actionType: v.literal('update'),
        details: v.object({
            after: v.array(channelOrderEntryValidator),
            before: v.array(channelOrderEntryValidator),
            changes: v.array(
                v.object({
                    after: v.array(channelOrderEntryValidator),
                    before: v.optional(v.array(channelOrderEntryValidator)),
                    field: v.literal('channelOrder'),
                })
            ),
            label: v.string(),
            ...optionalProviderFields,
        }),
        label: v.string(),
        targetId: v.string(),
        targetType: v.literal('channel-order'),
    })
);

export const blueprintPlanDecisionValidator = v.object({
    candidateTargetIds: v.optional(v.array(v.string())),
    changes: v.optional(
        v.array(
            v.object({
                after: v.any(),
                before: v.any(),
                field: v.string(),
            })
        )
    ),
    classification: v.union(
        v.literal('create'),
        v.literal('update'),
        v.literal('delete'),
        v.literal('no-op'),
        v.literal('unmanaged-retained'),
        v.literal('protected-retained'),
        v.literal('protected-omitted'),
        v.literal('blocked-ambiguous'),
        v.literal('blocked-unsupported')
    ),
    reason: v.union(
        v.literal('matched-change'),
        v.literal('matched-equal'),
        v.literal('source-unmatched'),
        v.literal('target-unmatched-delete'),
        v.literal('target-unmatched-retain'),
        v.literal('target-protected-retain'),
        v.literal('source-protected-omit'),
        v.literal('rebuild-delete'),
        v.literal('rebuild-create'),
        v.literal('blocked-ambiguous'),
        v.literal('blocked-unsupported')
    ),
    sourceId: v.optional(v.string()),
    targetId: v.optional(v.string()),
    targetType: entityKindValidator,
});

export const blueprintPlanStepRecordValidator = v.object({
    createdAt: v.string(),
    id: v.string(),
    planId: v.string(),
    sequence: v.number(),
    step: blueprintPlanStepValidator,
});
export const blueprintPlanDecisionRecordValidator = v.object({
    createdAt: v.string(),
    decision: blueprintPlanDecisionValidator,
    id: v.string(),
    planId: v.string(),
    sequence: v.number(),
});
export const blueprintPlanStepPageValidator = v.object({
    nextCursor: v.union(v.string(), v.null()),
    steps: v.array(blueprintPlanStepRecordValidator),
});

const preflightSummaryValidator = v.object({
    destructiveApprovalRequired: v.number(),
    invalidPlan: v.number(),
    mappingRequired: v.number(),
    ready: v.number(),
    stale: v.number(),
    total: v.number(),
    unsupported: v.number(),
});
export const blueprintPreflightReportValidator = v.object({
    steps: v.array(
        v.object({
            actionType: v.string(),
            label: v.optional(v.string()),
            message: v.string(),
            planStepId: v.string(),
            status: v.union(
                v.literal('ready'),
                v.literal('stale'),
                v.literal('mapping-required'),
                v.literal('destructive-approval-required'),
                v.literal('unsupported'),
                v.literal('invalid-plan')
            ),
            targetId: v.optional(v.string()),
            targetType: v.string(),
        })
    ),
    summary: preflightSummaryValidator,
});
const fenceEntityValidator = v.object({
    digest: v.string(),
    fieldDigests: v.array(v.string()),
    id: v.string(),
});
export const blueprintMutationFenceManifestValidator = v.object({
    capabilityDigest: v.string(),
    capabilityFields: v.array(
        v.object({
            digest: v.string(),
            field: v.union(
                v.literal('botHighestRolePosition'),
                v.literal('botRoleIds'),
                v.literal('protectedRoleIds'),
                v.literal('managedRoleIds'),
                v.literal('integrationRoleIds')
            ),
        })
    ),
    categories: v.array(fenceEntityValidator),
    channels: v.array(fenceEntityValidator),
    guildId: v.string(),
    roles: v.array(fenceEntityValidator),
    structureDigest: v.string(),
    version: v.literal(2),
});
export const blueprintPreflightEvidenceRecordValidator = v.object({
    createdAt: v.string(),
    evidenceDigest: v.string(),
    id: v.string(),
    manifestDigest: v.string(),
    mutationFenceManifest: blueprintMutationFenceManifestValidator,
    planId: v.string(),
    preflightId: v.string(),
    report: blueprintPreflightReportValidator,
    reportDigest: v.string(),
    version: v.literal(1),
});
export const blueprintPreflightEvidenceInputValidator = v.object({
    evidenceDigest: v.string(),
    manifestDigest: v.string(),
    mutationFenceManifest: blueprintMutationFenceManifestValidator,
    report: blueprintPreflightReportValidator,
    reportDigest: v.string(),
    version: v.literal(1),
});

export const blueprintVerificationResultValidator = v.union(
    v.object({
        actualStructureDigest: v.string(),
        expectedStructureDigest: v.string(),
        status: v.union(v.literal('matched'), v.literal('mismatch')),
        version: v.literal(1),
    }),
    v.object({
        reason: v.union(
            v.literal('provider-read-failed'),
            v.literal('projected-snapshot-invalid'),
            v.literal('verification-evidence-invalid'),
            v.literal('verification-evidence-too-large')
        ),
        status: v.literal('read_failed'),
        version: v.literal(1),
    })
);
export const blueprintRunVerificationEvidenceRecordValidator = v.object({
    createdAt: v.string(),
    id: v.string(),
    planId: v.string(),
    result: blueprintVerificationResultValidator,
    runId: v.string(),
    verificationEvidenceDigest: v.string(),
    verificationStatus: v.union(v.literal('matched'), v.literal('mismatch'), v.literal('read_failed')),
    version: v.literal(1),
});

export const blueprintPlanApprovalRecordValidator = v.object({
    approvedAt: v.string(),
    approvedByUserId: v.optional(v.string()),
    approvedCapabilityFingerprint: v.optional(v.string()),
    approvedStructureFingerprint: v.optional(v.string()),
    confirmationMethod: v.optional(v.union(v.literal('acknowledgement'), v.literal('target_name'))),
    deleteSetDigest: v.optional(v.string()),
    destructiveApprovedAt: v.optional(v.string()),
    destructivePreflightDigest: v.optional(v.string()),
    destructiveStepCount: v.optional(v.number()),
    fingerprintVersion: v.optional(v.literal(2)),
    id: v.string(),
    planDigest: v.string(),
    planId: v.string(),
});

export const blueprintRunStepAttemptRecordValidator = v.object({
    actionType: actionTypeValidator,
    attempt: v.number(),
    completedAt: v.optional(v.string()),
    completionDigest: v.optional(v.string()),
    createdAt: v.string(),
    createdId: v.optional(v.string()),
    displayLabel: v.string(),
    errorType: v.optional(v.string()),
    id: v.string(),
    planStepId: v.string(),
    planStepSequence: v.number(),
    requestKey: v.string(),
    retryAt: v.optional(v.string()),
    runId: v.string(),
    sourceId: v.optional(v.string()),
    startedAt: v.optional(v.string()),
    state: v.union(
        v.literal('pending'),
        v.literal('started'),
        v.literal('applied'),
        v.literal('failed'),
        v.literal('unknown')
    ),
    stepDigest: v.string(),
    targetId: v.string(),
    targetType: targetTypeValidator,
    updatedAt: v.string(),
});
export const blueprintRunStepPreparationRecordValidator = v.object({
    attempt: blueprintRunStepAttemptRecordValidator,
    kind: v.union(v.literal('prepared'), v.literal('control_requested')),
    run: hotRunRecordValidator,
});
export const blueprintRunStepStartRecordValidator = v.object({
    attempt: blueprintRunStepAttemptRecordValidator,
    kind: v.union(v.literal('started'), v.literal('control_requested')),
    run: hotRunRecordValidator,
});
export const blueprintRunStepCompletionRecordValidator = v.object({
    attempt: blueprintRunStepAttemptRecordValidator,
    run: hotRunRecordValidator,
});

const blueprintRunCursorRecordValidator = v.object({
    id: v.string(),
    idMap: v.record(v.string(), v.string()),
    planId: v.string(),
    runId: v.string(),
    updatedAt: v.string(),
    version: v.literal(1),
});
export const blueprintRunClaimRecordValidator = v.union(
    v.object({
        attempts: v.array(blueprintRunStepAttemptRecordValidator),
        authority: blueprintPlanAuthorityRecordValidator,
        cursor: blueprintRunCursorRecordValidator,
        decisions: v.array(blueprintPlanDecisionRecordValidator),
        executionAuthority: blueprintPlanExecutionAuthorityRecordValidator,
        kind: v.literal('claimed'),
        plan: planMetadataRecordValidator,
        run: hotRunRecordValidator,
        steps: v.array(blueprintPlanStepRecordValidator),
    }),
    v.object({
        guildId: v.string(),
        kind: v.literal('protocol_mismatch'),
        mayHaveExternalEffects: v.boolean(),
        requiredProtocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        runId: v.string(),
        runProtocolVersion: v.number(),
        status: v.string(),
    }),
    v.object({
        errorType: v.string(),
        guildId: v.string(),
        kind: v.literal('authority_invalid'),
        mayHaveExternalEffects: v.boolean(),
        runId: v.string(),
        status: v.union(v.literal('failed_before_mutation'), v.literal('partially_applied')),
    })
);
export const blueprintRunMutationAuthorizationRecordValidator = v.union(
    v.object({
        kind: v.union(v.literal('authorized'), v.literal('not_required')),
        run: hotRunRecordValidator,
    }),
    v.object({
        kind: v.literal('rejected'),
        reason: v.union(
            v.literal('preflight_expired'),
            v.literal('structure_changed'),
            v.literal('capability_changed'),
            v.literal('structure_and_capability_changed'),
            v.literal('restore_observation_diverged'),
            v.literal('fingerprint_version_mismatch')
        ),
        run: hotRunRecordValidator,
    })
);

export function toBlueprintPlanApprovalRecord(approval: Omit<Doc<'blueprintPlanApprovals'>, '_creationTime'>) {
    return {
        approvedAt: approval.approvedAt,
        ...(approval.approvedByUserId === undefined ? {} : { approvedByUserId: approval.approvedByUserId }),
        ...(approval.approvedCapabilityFingerprint === undefined
            ? {}
            : { approvedCapabilityFingerprint: approval.approvedCapabilityFingerprint }),
        ...(approval.approvedStructureFingerprint === undefined
            ? {}
            : { approvedStructureFingerprint: approval.approvedStructureFingerprint }),
        ...(approval.confirmationMethod === undefined ? {} : { confirmationMethod: approval.confirmationMethod }),
        ...(approval.deleteSetDigest === undefined ? {} : { deleteSetDigest: approval.deleteSetDigest }),
        ...(approval.destructiveApprovedAt === undefined
            ? {}
            : { destructiveApprovedAt: approval.destructiveApprovedAt }),
        ...(approval.destructivePreflightDigest === undefined
            ? {}
            : { destructivePreflightDigest: approval.destructivePreflightDigest }),
        ...(approval.destructiveStepCount === undefined ? {} : { destructiveStepCount: approval.destructiveStepCount }),
        ...(approval.fingerprintVersion === undefined ? {} : { fingerprintVersion: approval.fingerprintVersion }),
        id: String(approval._id),
        planDigest: approval.planDigest,
        planId: String(approval.planId),
    };
}

export function toBlueprintPlanAuthorityRecord(authority: BlueprintPlanAuthorityV1 & { _id: unknown }) {
    return {
        authorityDigest: authority.authorityDigest,
        blockers: authority.blockers,
        createdAt: authority.createdAt,
        guildId: authority.guildId,
        id: String(authority._id),
        mappings: authority.mappings,
        planId: authority.planId,
        projectedSnapshot: authority.projectedSnapshot,
        provenance: authority.provenance,
        referenceAuthority: authority.referenceAuthority,
        requestedSnapshot: authority.requestedSnapshot,
        roleProjection: authority.roleProjection,
        version: authority.version,
    };
}

export function toBlueprintPlanExecutionAuthorityRecord(
    authority: BlueprintPlanExecutionAuthorityV1 & { _id: unknown }
) {
    return {
        contentDigest: authority.contentDigest,
        createdAt: authority.createdAt,
        executionAuthorityDigest: authority.executionAuthorityDigest,
        guildId: authority.guildId,
        id: String(authority._id),
        initialIdMap: authority.initialIdMap,
        knownTargetKinds: authority.knownTargetKinds,
        planId: authority.planId,
        ...(authority.sourceGuildId === undefined ? {} : { sourceGuildId: authority.sourceGuildId }),
        sourceTargetMap: authority.sourceTargetMap,
        version: authority.version,
    };
}

export function toBlueprintRunStepAttemptRecord(attempt: Omit<Doc<'blueprintRunStepAttempts'>, '_creationTime'>) {
    return {
        actionType: attempt.actionType,
        attempt: attempt.attempt,
        ...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt }),
        ...(attempt.completionDigest === undefined ? {} : { completionDigest: attempt.completionDigest }),
        createdAt: attempt.createdAt,
        ...(attempt.createdId === undefined ? {} : { createdId: attempt.createdId }),
        displayLabel: attempt.displayLabel,
        ...(attempt.errorType === undefined ? {} : { errorType: attempt.errorType }),
        id: String(attempt._id),
        planStepId: String(attempt.planStepId),
        planStepSequence: attempt.planStepSequence,
        requestKey: attempt.requestKey,
        ...(attempt.retryAt === undefined ? {} : { retryAt: attempt.retryAt }),
        runId: String(attempt.runId),
        ...(attempt.sourceId === undefined ? {} : { sourceId: attempt.sourceId }),
        ...(attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt }),
        state: attempt.state,
        stepDigest: attempt.stepDigest,
        targetId: attempt.targetId,
        targetType: attempt.targetType,
        updatedAt: attempt.updatedAt,
    };
}

export function toBlueprintPlanStepRecord(step: Omit<Doc<'blueprintPlanSteps'>, '_creationTime'>) {
    const normalized = normalizeBlueprintPlanStep(step.step);

    if (normalized.type === 'invalid') {
        throw new Error('blueprint-plan-step-invalid');
    }

    return {
        createdAt: step.createdAt,
        id: String(step._id),
        planId: String(step.planId),
        sequence: step.sequence,
        step: normalized.value,
    };
}

export function toBlueprintPlanDecisionRecord(decision: Omit<Doc<'blueprintPlanDecisions'>, '_creationTime'>) {
    const normalized = normalizeBlueprintPlanDecision(decision.decision);

    if (normalized.type === 'invalid') {
        throw new Error('blueprint-plan-decision-invalid');
    }

    return {
        createdAt: decision.createdAt,
        decision: normalized.value,
        id: String(decision._id),
        planId: String(decision.planId),
        sequence: decision.sequence,
    };
}

export function toBlueprintRunCursorRecord(
    cursor: Omit<Doc<'blueprintRunCursors'>, '_creationTime'>,
    idMap: Record<string, string>
) {
    return {
        id: String(cursor._id),
        idMap,
        planId: String(cursor.planId),
        runId: String(cursor.runId),
        updatedAt: cursor.updatedAt,
        version: cursor.version,
    };
}

export { hotRunRecordValidator, planMetadataRecordValidator, toHotRunRecord };
