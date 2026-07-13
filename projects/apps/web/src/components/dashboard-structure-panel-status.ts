import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import { formatStatus } from './dashboard-structure-panel-format.js';
import type { PanelStatus } from './dashboard-structure-panel-types.js';

export function toRunActionStatus(result: {
    type: string;
    message?: string;
    expectedText?: string;
    status?: string;
}): PanelStatus {
    if (result.type === 'invalid-input' && result.message) return { tone: 'error', message: result.message };
    if (result.type === 'not-approvable' && result.status) {
        return { tone: 'error', message: `This plan is ${formatStatus(result.status)} and cannot be approved.` };
    }
    return toErrorStatus(result.type);
}

export function toApplyErrorStatus(result: {
    type: string;
    message?: string;
    expectedText?: string;
    status?: string;
    report?: DashboardStructurePreflightReport;
}): PanelStatus {
    if (result.type === 'invalid-input' && result.message) return { tone: 'error', message: result.message };
    if (result.type === 'destructive-confirmation-mismatch' && result.expectedText) {
        return { tone: 'error', message: `Type ${result.expectedText} exactly to approve deletes.` };
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
    if (result.type === 'execution-active') {
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
            'The Convex backend does not match this NeonFlux build. Deploy the matching backend before using Server Blueprint.',
        'execution-protocol-incompatible':
            'This deployment was created by a different Blueprint protocol and cannot be controlled by this build. Use the matching build or reset development data.',
        'bot-token-missing': 'The web service needs FLUXER_BOT_TOKEN to read server layout.',
        'restore-point-failed': 'Apply was not started because NeonFlux could not save a restore point.',
        'structure-read-failed': 'NeonFlux could not read this server layout.',
        'database-error': 'The dashboard database could not save the server blueprint data.',
        'guild-lookup-failed': 'This server could not be loaded from Fluxer.',
        'deployment-config-not-found': 'Dashboard deployment config is missing.',
        'not-found': 'This server is not available for this account.',
    };

    return {
        tone: 'error',
        message: messages[type] ?? 'Server blueprint operation failed.',
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
