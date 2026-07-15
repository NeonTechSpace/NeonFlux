import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import { formatDate } from './dashboard-blueprint-panel-format.js';

type Run = NonNullable<DashboardBlueprintPlan['run']>;

export function formatDashboardBlueprintDeployStatus(run: Run): string {
    if (run.status === 'succeeded') return 'Deployment complete';
    if (run.status === 'failed_before_mutation') return 'Deployment stopped safely';
    if (['partially_applied', 'needs_reconciliation', 'outcome_unknown'].includes(run.status)) {
        return 'Deployment needs attention';
    }
    if (run.status === 'paused') return `Paused · ${run.completedSteps} of ${run.totalSteps}`;
    if (run.status === 'waiting_rate_limit') {
        return run.retryAt ? `Rate limited · resumes ${formatDate(run.retryAt)}` : 'Rate limited';
    }
    if (run.phase === 'verifying') return 'Verifying result';
    if (['create', 'update', 'delete', 'channel_order', 'role_order'].includes(run.phase)) {
        return `Applying changes · ${run.completedSteps} of ${run.totalSteps}`;
    }
    if (run.restorePointBackupId) return 'Checking target';
    if (run.phase === 'preparing') return 'Saving restore point';
    return 'Queued';
}
