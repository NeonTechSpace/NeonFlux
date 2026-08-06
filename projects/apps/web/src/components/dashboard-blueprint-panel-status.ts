import type { DashboardBlueprintPreflightReport } from '../server/dashboard-blueprint-preflight.js';
import { formatStatus } from './dashboard-blueprint-panel-format.js';
import type { PanelStatus } from './dashboard-blueprint-panel-types.js';

export function toRunActionStatus(result: { type: string; message?: string; status?: string }): PanelStatus {
    if (result.type === 'invalid-input' && result.message) return { tone: 'error', message: result.message };
    if (result.type === 'not-approvable' && result.status) {
        return { tone: 'error', message: `This plan is ${formatStatus(result.status)} and cannot be approved.` };
    }
    return toErrorStatus(result.type);
}

export function toApplyErrorStatus(result: {
    type: string;
    message?: string;
    status?: string;
    report?: DashboardBlueprintPreflightReport;
}): PanelStatus {
    if (result.type === 'invalid-input' && result.message) return { tone: 'error', message: result.message };
    if (result.type === 'destructive-confirmation-mismatch' && result.message) {
        return { tone: 'error', message: result.message };
    }
    if (result.type === 'not-applicable' && result.status) {
        return { tone: 'error', message: `This plan is ${formatStatus(result.status)} and cannot be queued.` };
    }
    if (result.type === 'preflight-blocked' && result.report) {
        return {
            tone: 'error',
            message: `Apply blocked: ${result.report.summary.ready}/${result.report.summary.total} actions are ready.`,
        };
    }
    if (result.type === 'review-stale') {
        return {
            tone: 'error',
            message: 'The reviewed result or safety check is no longer current. Run the safety check again.',
        };
    }
    if (result.type === 'run-active') {
        return { tone: 'error', message: 'Another Blueprint deployment is already active for this server.' };
    }
    if (result.type === 'nothing-to-apply') {
        return { tone: 'neutral', message: 'This Blueprint already matches the server. Nothing needs to be applied.' };
    }
    return toErrorStatus(result.type);
}

export function toDriftErrorStatus(type: string): PanelStatus {
    if (type === 'no-baseline') {
        return { tone: 'error', message: 'Create a successful server blueprint backup before checking drift.' };
    }
    if (type === 'backup-json-unavailable') {
        return { tone: 'error', message: 'This backup does not have usable server blueprint JSON.' };
    }
    return toErrorStatus(type);
}

export function toErrorStatus(type: string): PanelStatus {
    const messages: Record<string, string> = {
        'auth-required': 'Sign in again before changing server blueprint data.',
        'backend-incompatible':
            'The dashboard and Convex backend use different NeonFlux versions. Deploy matching versions before using Server Blueprint.',
        'run-protocol-incompatible':
            'This deployment was created by a different NeonFlux version and cannot be controlled here. Use the matching version or reset development data.',
        'bot-token-missing':
            'NeonFlux cannot authenticate with the bot service. Check the bot and web service key configuration.',
        'restore-point-failed': 'Apply was not started because NeonFlux could not save a restore point.',
        'structure-read-failed': 'NeonFlux could not read this server layout.',
        'database-error':
            'NeonFlux could not save the Server Blueprint data. Check the Convex deployment and try again.',
        'guild-lookup-failed': 'This server could not be loaded from Fluxer.',
        'deployment-config-not-found':
            'NeonFlux deployment settings are missing. Run the deployment setup before using Server Blueprint.',
        'not-found': 'This server is not available for this account.',
    };

    return {
        tone: 'error',
        message:
            messages[type] ??
            'NeonFlux could not complete this Server Blueprint action. Try again and check the technical details if it fails again.',
    };
}

export function toUnexpectedErrorStatus(): PanelStatus {
    return {
        tone: 'error',
        message: 'NeonFlux could not complete this request. Check your connection and try again.',
    };
}

export function countPlanChanges(summary: { creates: number; deletes: number; updates: number }): number {
    return summary.creates + summary.updates + summary.deletes;
}
