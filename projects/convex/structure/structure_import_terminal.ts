export type StructureImportTerminalStatus =
    | 'succeeded'
    | 'partially_applied'
    | 'failed_before_mutation'
    | 'needs_reconciliation'
    | 'outcome_unknown'
    | 'cancelled';

export type StructureImportTerminalNotification =
    | { canonicalDestination: 'structure' }
    | { auditAction: string; canonicalDestination: 'audit' };

export function structureImportTerminalNotification(
    status: StructureImportTerminalStatus
): StructureImportTerminalNotification {
    if (status === 'failed_before_mutation') return { canonicalDestination: 'structure' };
    return {
        auditAction: `structure.import_execution_${status}`,
        canonicalDestination: 'audit',
    };
}
