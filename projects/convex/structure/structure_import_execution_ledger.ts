import {
    resolveStructureExecutionReferenceAuthority,
    validateStructureExecutionActionLedger,
} from './structure_model.js';

export async function assertStructureExecutionRunLedger(
    run: {
        deleteActionCount: number;
        deleteSetDigest?: string;
        guildId: string;
        plan: unknown;
    },
    actions: ReadonlyArray<{
        actionType: string;
        details: unknown;
        sequence: number;
        targetId?: string;
        targetType: string;
    }>
): Promise<void> {
    const summary = validateStructureExecutionActionLedger(run.plan, actions);
    if (resolveStructureExecutionReferenceAuthority(run.plan).knownTargetKinds[run.guildId] !== 'role') {
        throw new Error('structure-execution-default-role-authority-invalid');
    }
    const deleteSetDigest = summary.deleteActionCount > 0 ? await sha256Json(summary.deleteSetKeys) : undefined;
    if (run.deleteActionCount !== summary.deleteActionCount || run.deleteSetDigest !== deleteSetDigest) {
        throw new Error('structure-execution-delete-ledger-invalid');
    }
}

async function sha256Json(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
