import type { DashboardStructureExecutionProgress } from '../server/dashboard-structure-v2.js';

const terminalExecutionStatuses = new Set<DashboardStructureExecutionProgress['status']>([
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'needs_reconciliation',
    'outcome_unknown',
    'cancelled',
]);

export function isTerminalDashboardStructureExecution(execution: DashboardStructureExecutionProgress): boolean {
    return terminalExecutionStatuses.has(execution.status);
}

export function mergeDashboardStructureExecutionProgress(
    previous: DashboardStructureExecutionProgress | null | undefined,
    incoming: DashboardStructureExecutionProgress | null
): DashboardStructureExecutionProgress | null {
    if (!previous) return incoming;
    if (!incoming || incoming.id !== previous.id) return previous;
    if (isTerminalDashboardStructureExecution(previous) && !isTerminalDashboardStructureExecution(incoming)) {
        return previous;
    }

    return Date.parse(incoming.updatedAt) >= Date.parse(previous.updatedAt) ? incoming : previous;
}

export class DashboardStructureRequestError extends Error {
    readonly diagnosticCode: string;

    constructor(diagnosticCode: string) {
        super(diagnosticCode);
        this.name = 'DashboardStructureRequestError';
        this.diagnosticCode = diagnosticCode;
    }
}

export async function withDashboardStructureRequestTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            request,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new DashboardStructureRequestError('BLUEPRINT_LOAD_TIMEOUT')),
                    timeoutMs
                );
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export function readDashboardStructureDiagnosticCode(error: unknown): string {
    return error instanceof DashboardStructureRequestError ? error.diagnosticCode : 'BLUEPRINT_LOAD_REQUEST_FAILED';
}
