import { structureBackupSettingsTable } from './tables/structure_backup_settings.js';
import { structureBackupsTable } from './tables/structure_backups.js';
import { blueprintPlansTable } from './tables/blueprint_plans.js';
import { blueprintPlanStepsTable } from './tables/blueprint_plan_steps.js';
import { blueprintRunStepAttemptsTable } from './tables/blueprint_run_step_attempts.js';
import { blueprintPlanApprovalsTable } from './tables/blueprint_plan_approvals.js';
import { blueprintRunsTable } from './tables/blueprint_runs.js';
import { blueprintPlanDecisionsTable } from './tables/blueprint_plan_decisions.js';
import { blueprintPlanPreflightsTable } from './tables/blueprint_plan_preflights.js';
import { blueprintRunObservationsTable } from './tables/blueprint_run_observations.js';
import { blueprintPlanAuthoritiesTable } from './tables/blueprint_plan_authorities.js';
import { blueprintPlanExecutionAuthoritiesTable } from './tables/blueprint_plan_execution_authorities.js';
import { blueprintPlanExecutionAuthorityBucketsTable } from './tables/blueprint_plan_execution_authority_buckets.js';
import { blueprintPlanPreflightEvidenceTable } from './tables/blueprint_plan_preflight_evidence.js';
import { blueprintRunCursorsTable } from './tables/blueprint_run_cursors.js';
import { blueprintRunVerificationEvidenceTable } from './tables/blueprint_run_verification_evidence.js';
import { blueprintRunIdMappingsTable } from './tables/blueprint_run_id_mappings.js';

export const blueprintTables = {
    structureBackups: structureBackupsTable,
    structureBackupSettings: structureBackupSettingsTable,
    blueprintPlans: blueprintPlansTable,
    blueprintPlanAuthorities: blueprintPlanAuthoritiesTable,
    blueprintPlanExecutionAuthorities: blueprintPlanExecutionAuthoritiesTable,
    blueprintPlanExecutionAuthorityBuckets: blueprintPlanExecutionAuthorityBucketsTable,
    blueprintPlanSteps: blueprintPlanStepsTable,
    blueprintRunStepAttempts: blueprintRunStepAttemptsTable,
    blueprintPlanApprovals: blueprintPlanApprovalsTable,
    blueprintRuns: blueprintRunsTable,
    blueprintPlanDecisions: blueprintPlanDecisionsTable,
    blueprintPlanPreflights: blueprintPlanPreflightsTable,
    blueprintPlanPreflightEvidence: blueprintPlanPreflightEvidenceTable,
    blueprintRunObservations: blueprintRunObservationsTable,
    blueprintRunCursors: blueprintRunCursorsTable,
    blueprintRunIdMappings: blueprintRunIdMappingsTable,
    blueprintRunVerificationEvidence: blueprintRunVerificationEvidenceTable,
};
