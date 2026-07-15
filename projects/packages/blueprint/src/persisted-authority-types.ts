import type { BlueprintMutationFenceManifestV2 } from './mutation-fence.js';
import type {
    BlueprintEntityKind,
    BlueprintPlanBlocker,
    BlueprintPlanDecision,
    BlueprintPlanMappings,
    BlueprintPlanStep,
} from './plan.js';
import type { BlueprintPreflightReport } from './preflight-report.js';
import type { BlueprintRoleProjection } from './role-projection.js';
import type { BlueprintSnapshot } from './snapshot.js';

export const BLUEPRINT_PLAN_AUTHORITY_VERSION = 1 as const;
export const BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION = 1 as const;
export const BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT = 64 as const;
export const BLUEPRINT_PREFLIGHT_EVIDENCE_VERSION = 1 as const;
export const BLUEPRINT_RUN_CURSOR_VERSION = 1 as const;
export const BLUEPRINT_RUN_VERIFICATION_EVIDENCE_VERSION = 1 as const;
export const BLUEPRINT_PLAN_LEDGER_VERSION = 1 as const;

export type BlueprintPlanAuthorityProvenanceV1 = {
    source: 'dashboard-json' | 'backup' | 'dashboard-recovery-plan';
    requestedGuildId: string | null;
    requestedExportedAt: string | null;
    requestedSnapshotStoredAt: string;
    sourcePlanId?: string;
    sourceRunId?: string;
};

export type BlueprintPlanReferenceAuthorityV1 = {
    sourceTargetMap: Record<string, string | null>;
    knownTargetKinds: Record<string, BlueprintEntityKind>;
};

export type BlueprintPlanAuthorityBodyV1 = {
    requestedSnapshot: BlueprintSnapshot;
    projectedSnapshot: BlueprintSnapshot;
    roleProjection: BlueprintRoleProjection;
    mappings: BlueprintPlanMappings;
    referenceAuthority: BlueprintPlanReferenceAuthorityV1;
    blockers: BlueprintPlanBlocker[];
    provenance: BlueprintPlanAuthorityProvenanceV1;
};

export type BlueprintPlanAuthorityV1 = BlueprintPlanAuthorityBodyV1 & {
    version: typeof BLUEPRINT_PLAN_AUTHORITY_VERSION;
    planId: string;
    guildId: string;
    authorityDigest: string;
    createdAt: string;
};

export type BlueprintPlanExecutionAuthorityBodyV1 = {
    sourceGuildId?: string;
    sourceTargetMap: Record<string, string | null>;
    knownTargetKinds: Record<string, BlueprintEntityKind>;
    initialIdMap: Record<string, string>;
};

export type BlueprintPlanExecutionAuthorityV1 = BlueprintPlanExecutionAuthorityBodyV1 & {
    version: typeof BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION;
    planId: string;
    guildId: string;
    contentDigest: string;
    executionAuthorityDigest: string;
    createdAt: string;
};

export type BlueprintPlanExecutionAuthorityManifestV1 = {
    version: typeof BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION;
    planId: string;
    guildId: string;
    sourceGuildId?: string;
    bucketCount: typeof BLUEPRINT_PLAN_EXECUTION_AUTHORITY_BUCKET_COUNT;
    contentDigest: string;
    bucketDigests: string[];
    executionAuthorityDigest: string;
    createdAt: string;
};

export type BlueprintPlanExecutionAuthorityBucketV1 = {
    version: typeof BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION;
    planId: string;
    guildId: string;
    bucket: number;
    sourceTargetMap: Record<string, string | null>;
    knownTargetKinds: Record<string, BlueprintEntityKind>;
    bucketDigest: string;
    createdAt: string;
};

export type BlueprintPlanStepLedgerEntryV1 = {
    sequence: number;
    step: BlueprintPlanStep;
};

export type BlueprintPlanDecisionLedgerEntryV1 = {
    sequence: number;
    decision: BlueprintPlanDecision;
};

export type BlueprintPreflightEvidenceV1 = {
    version: typeof BLUEPRINT_PREFLIGHT_EVIDENCE_VERSION;
    preflightId: string;
    planId: string;
    report: BlueprintPreflightReport;
    mutationFenceManifest: BlueprintMutationFenceManifestV2;
    reportDigest: string;
    manifestDigest: string;
    evidenceDigest: string;
    createdAt: string;
};

export type BlueprintRunCursorV1 = {
    version: typeof BLUEPRINT_RUN_CURSOR_VERSION;
    runId: string;
    planId: string;
    idMap: Record<string, string>;
    updatedAt: string;
};

export type BlueprintVerificationStatus = 'matched' | 'mismatch' | 'read_failed';
export type BlueprintVerificationReadFailureReason =
    | 'provider-read-failed'
    | 'projected-snapshot-invalid'
    | 'verification-evidence-invalid'
    | 'verification-evidence-too-large';

export type BlueprintVerificationResult =
    | {
          version: 1;
          status: 'matched' | 'mismatch';
          expectedStructureDigest: string;
          actualStructureDigest: string;
      }
    | {
          version: 1;
          status: 'read_failed';
          reason: BlueprintVerificationReadFailureReason;
      };

export type BlueprintRunVerificationEvidenceV1 = {
    version: typeof BLUEPRINT_RUN_VERIFICATION_EVIDENCE_VERSION;
    runId: string;
    planId: string;
    verificationStatus: BlueprintVerificationStatus;
    result: BlueprintVerificationResult;
    verificationEvidenceDigest: string;
    createdAt: string;
};
