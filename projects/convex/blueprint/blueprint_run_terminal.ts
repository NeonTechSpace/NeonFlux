export type BlueprintRunTerminalStatus =
    | 'succeeded'
    | 'partially_applied'
    | 'failed_before_mutation'
    | 'needs_reconciliation'
    | 'outcome_unknown'
    | 'cancelled';

export type BlueprintRunTerminalNotification =
    | { canonicalDestination: 'blueprint' }
    | { auditAction: string; canonicalDestination: 'audit' };

export function blueprintRunTerminalNotification(status: BlueprintRunTerminalStatus): BlueprintRunTerminalNotification {
    if (status === 'failed_before_mutation') return { canonicalDestination: 'blueprint' };
    return {
        auditAction: `blueprint.run_${status}`,
        canonicalDestination: 'audit',
    };
}
