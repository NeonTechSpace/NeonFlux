import type { DashboardBlueprintRunProgress } from '../server/dashboard-blueprint-contracts.js';

const terminalRunStatuses = new Set<DashboardBlueprintRunProgress['status']>([
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'needs_reconciliation',
    'outcome_unknown',
    'cancelled',
]);

export function isTerminalDashboardBlueprintRun(run: DashboardBlueprintRunProgress): boolean {
    return terminalRunStatuses.has(run.status);
}

export function mergeDashboardBlueprintRunProgress(
    previous: DashboardBlueprintRunProgress | null | undefined,
    incoming: DashboardBlueprintRunProgress | null
): DashboardBlueprintRunProgress | null {
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
        incoming.completedSteps < previous.completedSteps ||
        incoming.failedSteps < previous.failedSteps ||
        incoming.totalSteps < previous.totalSteps
    ) {
        return previous;
    }

    const previousUpdatedAt = Date.parse(previous.updatedAt);
    const incomingUpdatedAt = Date.parse(incoming.updatedAt);
    if (!Number.isFinite(incomingUpdatedAt)) return previous;
    if (Number.isFinite(previousUpdatedAt) && incomingUpdatedAt < previousUpdatedAt) return previous;
    if (isTerminalDashboardBlueprintRun(previous) && !isTerminalDashboardBlueprintRun(incoming)) {
        return previous;
    }
    if (
        incomingUpdatedAt === previousUpdatedAt &&
        isTerminalDashboardBlueprintRun(previous) &&
        isTerminalDashboardBlueprintRun(incoming)
    ) {
        return previous;
    }

    return incoming;
}

export class DashboardBlueprintRequestError extends Error {
    readonly diagnosticCode: string;

    constructor(diagnosticCode: string) {
        super(diagnosticCode);
        this.name = 'DashboardBlueprintRequestError';
        this.diagnosticCode = diagnosticCode;
    }
}

export async function withDashboardBlueprintRequestTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            request,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new DashboardBlueprintRequestError('BLUEPRINT_LOAD_TIMEOUT')),
                    timeoutMs
                );
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export function readDashboardBlueprintDiagnosticCode(error: unknown): string {
    return error instanceof DashboardBlueprintRequestError ? error.diagnosticCode : 'BLUEPRINT_LOAD_REQUEST_FAILED';
}
