const applyLeaseDurationMs = 15 * 60 * 1000;
const applyHeartbeatIntervalMs = 30 * 1000;

export type DashboardStructureApplyAttempt = {
    attemptId: string;
    heartbeatAt: string;
    leaseExpiresAt: string;
    leaseOwner: string;
    outcome: 'active' | 'failed' | 'succeeded' | 'unknown';
    roleOrder: {
        status: 'pending' | 'applied' | 'failed' | 'not-required';
        errorType?: string;
    };
    startedAt: string;
    completedAt?: string;
    recoveredAt?: string;
    restorePointBackupId?: string;
};

export function createDashboardStructureApplyAttempt(input: {
    attemptId: string;
    leaseOwner: string;
    now: Date;
    roleOrderRequired: boolean;
}): DashboardStructureApplyAttempt {
    const now = input.now.toISOString();

    return {
        attemptId: input.attemptId,
        heartbeatAt: now,
        leaseExpiresAt: new Date(input.now.getTime() + applyLeaseDurationMs).toISOString(),
        leaseOwner: input.leaseOwner,
        outcome: 'active',
        roleOrder: { status: input.roleOrderRequired ? 'pending' : 'not-required' },
        startedAt: now,
    };
}

export function renewDashboardStructureApplyAttempt(
    attempt: DashboardStructureApplyAttempt,
    now: Date
): DashboardStructureApplyAttempt {
    return {
        ...attempt,
        heartbeatAt: now.toISOString(),
        leaseExpiresAt: new Date(now.getTime() + applyLeaseDurationMs).toISOString(),
    };
}

export function completeDashboardStructureApplyAttempt(
    attempt: DashboardStructureApplyAttempt,
    input: {
        now: Date;
        outcome: 'failed' | 'succeeded';
        roleOrderErrorType?: string;
        roleOrderStatus?: 'applied' | 'failed';
        restorePointBackupId?: string;
    }
): DashboardStructureApplyAttempt {
    return {
        ...attempt,
        completedAt: input.now.toISOString(),
        outcome: input.outcome,
        roleOrder: input.roleOrderStatus
            ? {
                  status: input.roleOrderStatus,
                  ...(input.roleOrderErrorType ? { errorType: input.roleOrderErrorType } : {}),
              }
            : attempt.roleOrder,
        ...(input.restorePointBackupId ? { restorePointBackupId: input.restorePointBackupId } : {}),
    };
}

export function recoverDashboardStructureApplyAttempt(
    attempt: DashboardStructureApplyAttempt,
    now: Date
): DashboardStructureApplyAttempt {
    return {
        ...attempt,
        completedAt: now.toISOString(),
        outcome: 'unknown',
        recoveredAt: now.toISOString(),
    };
}

export function readDashboardStructureApplyAttempt(
    plan: Record<string, unknown>
): DashboardStructureApplyAttempt | undefined {
    const value = plan.applyAttempt;
    if (!isObject(value) || !isNonEmptyString(value.attemptId) || !isNonEmptyString(value.leaseOwner)) {
        return undefined;
    }
    if (!isTimestamp(value.startedAt) || !isTimestamp(value.heartbeatAt) || !isTimestamp(value.leaseExpiresAt)) {
        return undefined;
    }
    if (!isApplyOutcome(value.outcome) || !isObject(value.roleOrder) || !isRoleOrderStatus(value.roleOrder.status)) {
        return undefined;
    }

    return {
        attemptId: value.attemptId,
        heartbeatAt: value.heartbeatAt,
        leaseExpiresAt: value.leaseExpiresAt,
        leaseOwner: value.leaseOwner,
        outcome: value.outcome,
        roleOrder: {
            status: value.roleOrder.status,
            ...(isNonEmptyString(value.roleOrder.errorType) ? { errorType: value.roleOrder.errorType } : {}),
        },
        startedAt: value.startedAt,
        ...(isTimestamp(value.completedAt) ? { completedAt: value.completedAt } : {}),
        ...(isTimestamp(value.recoveredAt) ? { recoveredAt: value.recoveredAt } : {}),
        ...(isNonEmptyString(value.restorePointBackupId) ? { restorePointBackupId: value.restorePointBackupId } : {}),
    };
}

export function isDashboardStructureApplyAttemptExpired(
    plan: Record<string, unknown>,
    now: Date = new Date()
): boolean {
    const attempt = readDashboardStructureApplyAttempt(plan);
    return attempt?.outcome === 'active' && Date.parse(attempt.leaseExpiresAt) <= now.getTime();
}

export async function runWithDashboardStructureApplyHeartbeat<TValue>(input: {
    operation: () => Promise<TValue>;
    renew: (now: Date) => Promise<void>;
    intervalMs?: number;
}): Promise<{ heartbeatFailed: boolean; value: TValue }> {
    let heartbeatFailed = false;
    let pendingRenewal = Promise.resolve();
    const timer = setInterval(() => {
        pendingRenewal = pendingRenewal
            .then(() => input.renew(new Date()))
            .catch(() => {
                heartbeatFailed = true;
            });
    }, input.intervalMs ?? applyHeartbeatIntervalMs);

    try {
        const value = await input.operation();
        clearInterval(timer);
        await pendingRenewal;
        return { heartbeatFailed, value };
    } finally {
        clearInterval(timer);
    }
}

function isApplyOutcome(value: unknown): value is DashboardStructureApplyAttempt['outcome'] {
    return value === 'active' || value === 'failed' || value === 'succeeded' || value === 'unknown';
}

function isRoleOrderStatus(value: unknown): value is DashboardStructureApplyAttempt['roleOrder']['status'] {
    return value === 'pending' || value === 'applied' || value === 'failed' || value === 'not-required';
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
