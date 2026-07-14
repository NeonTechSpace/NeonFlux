import { resolveBlueprintRunReferenceAuthority, validateBlueprintRunPlanStepLedger } from './blueprint_model.js';

export async function assertBlueprintRunPlanLedger(
    plan: {
        deleteStepCount: number;
        deleteSetDigest?: string;
        guildId: string;
        plan: unknown;
    },
    steps: ReadonlyArray<{
        actionType: string;
        details: unknown;
        sequence: number;
        targetId?: string;
        targetType: string;
    }>
): Promise<void> {
    const summary = validateBlueprintRunPlanStepLedger(plan.plan, steps);
    if (resolveBlueprintRunReferenceAuthority(plan.plan).knownTargetKinds[plan.guildId] !== 'role') {
        throw new Error('blueprint-run-default-role-authority-invalid');
    }
    const deleteSetDigest = summary.deleteStepCount > 0 ? await sha256Json(summary.deleteSetKeys) : undefined;
    if (plan.deleteStepCount !== summary.deleteStepCount || plan.deleteSetDigest !== deleteSetDigest) {
        throw new Error('blueprint-run-delete-ledger-invalid');
    }
}

async function sha256Json(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
