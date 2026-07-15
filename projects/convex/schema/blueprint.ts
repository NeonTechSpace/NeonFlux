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

export const blueprintTables = {
    structureBackups: structureBackupsTable,
    structureBackupSettings: structureBackupSettingsTable,
    blueprintPlans: blueprintPlansTable,
    blueprintPlanSteps: blueprintPlanStepsTable,
    blueprintRunStepAttempts: blueprintRunStepAttemptsTable,
    blueprintPlanApprovals: blueprintPlanApprovalsTable,
    blueprintRuns: blueprintRunsTable,
    blueprintPlanDecisions: blueprintPlanDecisionsTable,
    blueprintPlanPreflights: blueprintPlanPreflightsTable,
    blueprintRunObservations: blueprintRunObservationsTable,
};
