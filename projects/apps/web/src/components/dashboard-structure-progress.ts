import type { DashboardStructureExecutionProgress } from '../server/dashboard-structure-contracts.js';

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
    if (!incoming) return previous;
    if (incoming.id !== previous.id) {
        const previousCreatedAt = Date.parse(previous.createdAt);
        const incomingCreatedAt = Date.parse(incoming.createdAt);
        return Number.isFinite(previousCreatedAt) &&
            Number.isFinite(incomingCreatedAt) &&
            incomingCreatedAt > previousCreatedAt
            ? incoming
            : previous;
    }
    if (incoming.protocolVersion !== previous.protocolVersion) return previous;
    if (
        incoming.completedActions < previous.completedActions ||
        incoming.failedActions < previous.failedActions ||
        incoming.totalActions < previous.totalActions
    ) {
        return previous;
    }

    const previousUpdatedAt = Date.parse(previous.updatedAt);
    const incomingUpdatedAt = Date.parse(incoming.updatedAt);
    if (!Number.isFinite(incomingUpdatedAt)) return previous;
    if (Number.isFinite(previousUpdatedAt) && incomingUpdatedAt < previousUpdatedAt) return previous;
    if (isTerminalDashboardStructureExecution(previous) && !isTerminalDashboardStructureExecution(incoming)) {
        return previous;
    }
    if (
        incomingUpdatedAt === previousUpdatedAt &&
        isTerminalDashboardStructureExecution(previous) &&
        isTerminalDashboardStructureExecution(incoming)
    ) {
        return previous;
    }

    return incoming;
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
