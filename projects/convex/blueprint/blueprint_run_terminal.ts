export type BlueprintRunTerminalStatus =
    | 'succeeded'
    | 'partially_applied'
    | 'failed_before_mutation'
    | 'needs_reconciliation'
    | 'outcome_unknown'
    | 'cancelled';

export type BlueprintRunTerminalNotification = { auditAction: string; canonicalDestination: 'audit' };

export function blueprintRunTerminalNotification(status: BlueprintRunTerminalStatus): BlueprintRunTerminalNotification {
    return {
        auditAction: `blueprint.run_${status}`,
        canonicalDestination: 'audit',
    };
}
