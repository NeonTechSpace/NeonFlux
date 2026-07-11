import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { ConvexHttpClient } from 'convex/browser';
import { ConvexReactClient } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    getDashboardStructureExecutionProgressQueryKey,
    getDashboardStructureSettingsQueryKey,
} from '../dashboard-query-keys.js';
import { createDashboardRequestDeadline, settleDashboardRequestWithAbort } from '../dashboard-request-deadline.js';
import type { DashboardRequestDeadline } from '../dashboard-request-deadline.js';
import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../dashboard-structure-execution-protocol.js';
import { dashboardStructureExecutionPhases } from '../server/dashboard-structure-contracts.js';
import type { DashboardStructureExecutionProgress } from '../server/dashboard-structure-contracts.js';
import { fetchDashboardConvexToken, readDashboardConvexUrl } from './dashboard-live-invalidation.js';
import {
    isTerminalDashboardStructureExecution,
    mergeDashboardStructureExecutionProgress,
} from './dashboard-structure-progress.js';

const progressPollIntervalMs = 4_000;
const progressPollRequestTimeoutMs = 10_000;
const progressPollStaleTimeMs = 1_500;
const progressTokenRequestTimeoutMs = 6_000;
const progressTransportHealthMaxAgeMs = 12_000;
const progressWatchTimeoutMs = 12_000;
const progressTokenRefreshWindowMs = 30_000;
const progressTokenFallbackLifetimeMs = 60_000;
const executionStatuses = new Set<DashboardStructureExecutionProgress['status']>([
    'queued',
    'running',
    'waiting_rate_limit',
    'pause_requested',
    'paused',
    'verifying',
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'needs_reconciliation',
    'outcome_unknown',
    'cancelled',
]);

type ProgressIssue = {
    at: number;
    code: string;
    runId: string;
};

type ProgressCache = {
    execution: DashboardStructureExecutionProgress | null;
};

type ProgressToken = {
    expiresAt: number;
    value: string;
};

type ProgressTokenRequest = {
    deadline: DashboardRequestDeadline;
    promise: Promise<ProgressToken>;
};

type ProgressTransportHealth = {
    confirmedAt: number;
    runId: string;
};

export type DashboardStructureProgressTransport = {
    mode: 'idle' | 'live' | 'polling' | 'reconnecting' | 'incompatible' | 'unavailable';
    confirmedAt?: number;
};

export function useDashboardStructureExecutionProgress({
    guildId,
    runId,
    initialExecution,
}: {
    guildId: string;
    runId: string | undefined;
    initialExecution: DashboardStructureExecutionProgress | undefined;
}) {
    const queryClient = useQueryClient();
    const [watchAttempt, setWatchAttempt] = useState(0);
    const [watchIssue, setWatchIssue] = useState<ProgressIssue>();
    const [liveHealth, setLiveHealth] = useState<ProgressTransportHealth>();
    const [pollHealth, setPollHealth] = useState<ProgressTransportHealth>();
    const progressTokenRef = useRef<ProgressToken | undefined>(undefined);
    const progressTokenRequestRef = useRef<ProgressTokenRequest | undefined>(undefined);
    const terminalRefreshExecutionIdRef = useRef<string | undefined>(undefined);
    const confirmPollHealth = useCallback((confirmedRunId: string) => {
        setPollHealth({ confirmedAt: Date.now(), runId: confirmedRunId });
    }, []);
    const convexUrl = readDashboardConvexUrl();
    const queryKey = useMemo(
        () => getDashboardStructureExecutionProgressQueryKey(guildId, runId ?? 'none'),
        [guildId, runId]
    );
    // Transport configuration and the short-lived auth cache do not change the guild/run query identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const progressQuery = useQuery<ProgressCache>({
        queryKey,
        queryFn: async ({ signal }) => {
            if (!convexUrl || !runId) {
                throw new DashboardProgressReadError('BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE');
            }

            const deadline = createDashboardRequestDeadline(signal, progressPollRequestTimeoutMs);

            try {
                const token = await readProgressToken(deadline.signal);
                const client = new ConvexHttpClient(convexUrl, {
                    auth: token,
                    fetch: (input, init) => globalThis.fetch(input, { ...init, signal: deadline.signal }),
                    logger: false,
                });
                const result = await settleDashboardRequestWithAbort(
                    client.query(api.structure.findStructureImportExecutionProgressForGuild, {
                        guildId,
                        protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                        runId: runId as Id<'structureImportRuns'>,
                    }),
                    deadline.signal
                );
                const execution = toDashboardExecutionProgress(result);
                confirmPollHealth(runId);
                return {
                    execution,
                };
            } catch (error) {
                if (isAuthenticationError(error)) progressTokenRef.current = undefined;
                throw error;
            } finally {
                deadline.dispose();
            }
        },
        enabled: Boolean(convexUrl && runId),
        initialData: { execution: initialExecution ?? null },
        initialDataUpdatedAt: 0,
        refetchInterval: (query) => {
            if (query.state.error && isProgressProtocolIncompatibility(progressIssueCode(query.state.error))) {
                return false;
            }
            const { execution } = query.state.data ?? { execution: null };
            return execution && isTerminalDashboardStructureExecution(execution) ? false : progressPollIntervalMs;
        },
        refetchIntervalInBackground: false,
        refetchOnReconnect: 'always',
        refetchOnWindowFocus: 'always',
        retry: (failureCount, error) => {
            const code = progressIssueCode(error);
            return (
                code !== 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE' &&
                code !== 'BLUEPRINT_EXECUTION_PROTOCOL_INCOMPATIBLE' &&
                code !== 'BLUEPRINT_PROGRESS_TIMEOUT' &&
                failureCount < 2
            );
        },
        retryDelay: (failureCount) => Math.min(100 * 2 ** failureCount, 1_000),
        staleTime: progressPollStaleTimeMs,
        structuralSharing: (previous, incoming) =>
            mergeProgressCache(previous as ProgressCache | undefined, incoming as ProgressCache),
    });
    const execution = progressQuery.data.execution;
    const terminal = execution ? isTerminalDashboardStructureExecution(execution) : false;

    async function readProgressToken(signal: AbortSignal): Promise<string> {
        const cached = progressTokenRef.current;
        if (cached && cached.expiresAt - progressTokenRefreshWindowMs > Date.now()) return cached.value;

        const outstanding = progressTokenRequestRef.current;
        if (outstanding) return (await settleDashboardRequestWithAbort(outstanding.promise, signal)).value;

        const deadline = createDashboardRequestDeadline(signal, progressTokenRequestTimeoutMs);
        const request = settleDashboardRequestWithAbort(
            (async (): Promise<ProgressToken> => {
                const value = await fetchDashboardConvexToken(deadline.signal);
                if (!value) throw new DashboardProgressReadError('BLUEPRINT_PROGRESS_AUTH_UNAVAILABLE');
                return {
                    expiresAt: readJwtExpiration(value) ?? Date.now() + progressTokenFallbackLifetimeMs,
                    value,
                };
            })(),
            deadline.signal
        );
        const trackedRequest = { deadline, promise: request };
        progressTokenRequestRef.current = trackedRequest;

        try {
            const token = await request;
            progressTokenRef.current = token;
            return token.value;
        } finally {
            deadline.dispose();
            if (progressTokenRequestRef.current === trackedRequest) progressTokenRequestRef.current = undefined;
        }
    }

    useEffect(() => {
        if (!runId || !initialExecution) return;
        queryClient.setQueryData<ProgressCache>(queryKey, (current) =>
            mergeProgressCache(current, { execution: initialExecution })
        );
    }, [initialExecution, queryClient, queryKey, runId]);

    useEffect(() => {
        const currentHealth = [liveHealth, pollHealth].filter(
            (health): health is ProgressTransportHealth =>
                health !== undefined && runId !== undefined && health.runId === runId
        );
        if (currentHealth.length === 0) return undefined;

        const nextExpiry = Math.min(
            ...currentHealth.map((health) => health.confirmedAt + progressTransportHealthMaxAgeMs)
        );
        const timeout = setTimeout(
            () => {
                const now = Date.now();
                setLiveHealth((current) => (isExpiredTransportHealth(current, runId, now) ? undefined : current));
                setPollHealth((current) => (isExpiredTransportHealth(current, runId, now) ? undefined : current));
            },
            Math.max(0, nextExpiry - Date.now()) + 1
        );

        return () => clearTimeout(timeout);
    }, [liveHealth, pollHealth, runId]);

    useEffect(() => {
        if (!runId || terminal || typeof window === 'undefined' || !convexUrl) return undefined;

        const activeRunId = runId;
        const client = new ConvexReactClient(convexUrl, { logger: false });
        client.setAuth(() => fetchDashboardConvexToken());
        let active = true;
        let receivedResult = false;
        let unsubscribe: () => void = () => undefined;
        let watch: ReturnType<ConvexReactClient['watchQuery']> | undefined;
        const timeout = setTimeout(() => {
            if (!receivedResult) recordWatchIssue('BLUEPRINT_PROGRESS_TIMEOUT');
        }, progressWatchTimeoutMs);

        function recordWatchIssue(code: string): void {
            if (!active) return;
            setLiveHealth((current) => (current?.runId === activeRunId ? undefined : current));
            setWatchIssue((current) =>
                current?.code === code && current.runId === activeRunId
                    ? current
                    : { at: Date.now(), code, runId: activeRunId }
            );
        }

        function readProgress(): void {
            if (!active) return;
            try {
                const result = watch?.localQueryResult();
                if (result === undefined) return;
                receivedResult = true;
                clearTimeout(timeout);
                const incoming = toDashboardExecutionProgress(result);
                queryClient.setQueryData<ProgressCache>(queryKey, (current) =>
                    mergeProgressCache(current, {
                        execution: incoming,
                    })
                );
                setLiveHealth({ confirmedAt: Date.now(), runId: activeRunId });
                setWatchIssue(undefined);
            } catch (error) {
                clearTimeout(timeout);
                recordWatchIssue(progressIssueCode(error));
            }
        }

        try {
            watch = client.watchQuery(api.structure.findStructureImportExecutionProgressForGuild, {
                guildId,
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                runId: activeRunId as Id<'structureImportRuns'>,
            });
            unsubscribe = watch.onUpdate(readProgress);
            readProgress();
        } catch (error) {
            clearTimeout(timeout);
            recordWatchIssue(progressIssueCode(error));
        }

        return () => {
            active = false;
            clearTimeout(timeout);
            unsubscribe();
            void client.close();
        };
    }, [convexUrl, guildId, queryClient, queryKey, runId, terminal, watchAttempt]);

    useEffect(() => {
        if (!execution || !isTerminalDashboardStructureExecution(execution)) return;
        if (terminalRefreshExecutionIdRef.current === execution.id) return;

        terminalRefreshExecutionIdRef.current = execution.id;
        void queryClient.invalidateQueries({ queryKey: getDashboardStructureSettingsQueryKey(guildId) });
    }, [execution, guildId, queryClient]);

    const pollIssue = progressQuery.isError
        ? {
              at: progressQuery.errorUpdatedAt,
              code: progressIssueCode(progressQuery.error),
              runId: runId ?? 'none',
          }
        : undefined;
    // The expiry timer wakes the UI, but background-tab throttling can delay it. Re-check wall-clock freshness
    // whenever React renders so an old confirmation never suppresses a current transport failure.
    // eslint-disable-next-line react-hooks/purity
    const healthCheckedAt = Date.now();
    const activeWatchIssue =
        watchIssue &&
        watchIssue.runId === runId &&
        (isProgressProtocolIncompatibility(watchIssue.code) ||
            !isTransportHealthRecentAt(pollHealth, runId, watchIssue.at, healthCheckedAt))
            ? watchIssue
            : undefined;
    const activePollIssue =
        pollIssue &&
        (isProgressProtocolIncompatibility(pollIssue.code) ||
            !isTransportHealthRecentAt(liveHealth, runId, pollIssue.at, healthCheckedAt))
            ? pollIssue
            : undefined;
    const activeIssues = [activeWatchIssue, activePollIssue].filter(
        (issue): issue is ProgressIssue => issue !== undefined
    );
    const issueCode: string | undefined = activeIssues.some(
        (issue) => issue.code === 'BLUEPRINT_EXECUTION_PROTOCOL_INCOMPATIBLE'
    )
        ? 'BLUEPRINT_EXECUTION_PROTOCOL_INCOMPATIBLE'
        : activeIssues.some((issue) => issue.code === 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE')
          ? 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE'
          : activeIssues.reduce<ProgressIssue | undefined>(
                (latest, issue) => (!latest || issue.at > latest.at ? issue : latest),
                undefined
            )?.code;

    const effectiveIssueCode = runId && !convexUrl ? 'BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE' : issueCode;
    const liveHealthy =
        isCurrentTransportHealth(liveHealth, runId) && !isExpiredTransportHealth(liveHealth, runId, healthCheckedAt);
    const pollHealthy =
        isCurrentTransportHealth(pollHealth, runId) && !isExpiredTransportHealth(pollHealth, runId, healthCheckedAt);
    const confirmedAt = Math.max(liveHealthy ? liveHealth.confirmedAt : 0, pollHealthy ? pollHealth.confirmedAt : 0);
    const transport: DashboardStructureProgressTransport = {
        mode: !runId
            ? 'idle'
            : isProgressProtocolIncompatibility(effectiveIssueCode ?? '')
              ? 'incompatible'
              : liveHealthy
                ? 'live'
                : pollHealthy
                  ? 'polling'
                  : !convexUrl
                    ? 'unavailable'
                    : 'reconnecting',
        ...(confirmedAt > 0 ? { confirmedAt } : {}),
    };

    return {
        execution,
        issueCode: effectiveIssueCode,
        transport,
        retry: () => {
            const tokenRequest = progressTokenRequestRef.current;
            progressTokenRequestRef.current = undefined;
            tokenRequest?.deadline.abort();
            setLiveHealth(undefined);
            setPollHealth(undefined);
            setWatchIssue(undefined);
            setWatchAttempt((current) => current + 1);
            void progressQuery.refetch({ cancelRefetch: true });
        },
    };
}

type ExecutionProgressQueryResult = {
    appliedActions: number;
    completedAt?: string;
    createdAt: string;
    currentActionLabel?: string;
    errorType?: string;
    failedActions: number;
    id: string;
    phase: string;
    protocolVersion: number;
    retryAt?: string;
    skippedActions: number;
    startedAt?: string;
    status: string;
    totalActions: number;
    updatedAt: string;
};

function toDashboardExecutionProgress(
    result: ExecutionProgressQueryResult | null
): DashboardStructureExecutionProgress | null {
    if (!result) return null;
    if (result.protocolVersion !== STRUCTURE_EXECUTION_PROTOCOL_VERSION) {
        throw new DashboardProgressReadError('BLUEPRINT_EXECUTION_PROTOCOL_INCOMPATIBLE');
    }
    if (!executionStatuses.has(result.status as DashboardStructureExecutionProgress['status'])) {
        throw new Error('invalid-blueprint-execution-status');
    }
    if (!dashboardStructureExecutionPhases.includes(result.phase as DashboardStructureExecutionProgress['phase'])) {
        throw new Error('invalid-blueprint-execution-phase');
    }

    return {
        id: result.id,
        protocolVersion: result.protocolVersion,
        status: result.status as DashboardStructureExecutionProgress['status'],
        phase: result.phase as DashboardStructureExecutionProgress['phase'],
        completedActions: result.appliedActions + result.failedActions + result.skippedActions,
        failedActions: result.failedActions,
        totalActions: result.totalActions,
        ...(result.currentActionLabel ? { currentActionLabel: result.currentActionLabel } : {}),
        ...(result.retryAt ? { retryAt: result.retryAt } : {}),
        ...(result.errorType ? { errorType: result.errorType } : {}),
        createdAt: result.createdAt,
        ...(result.startedAt ? { startedAt: result.startedAt } : {}),
        updatedAt: result.updatedAt,
        ...(result.completedAt ? { completedAt: result.completedAt } : {}),
    };
}

function mergeProgressCache(previous: ProgressCache | undefined, incoming: ProgressCache): ProgressCache {
    return {
        execution: mergeDashboardStructureExecutionProgress(previous?.execution, incoming.execution),
    };
}

class DashboardProgressReadError extends Error {
    readonly diagnosticCode: string;

    constructor(diagnosticCode: string) {
        super(diagnosticCode);
        this.name = 'DashboardProgressReadError';
        this.diagnosticCode = diagnosticCode;
    }
}

function progressIssueCode(error: unknown): string {
    if (error instanceof DashboardProgressReadError) return error.diagnosticCode;
    if (hasErrorName(error, 'TimeoutError')) return 'BLUEPRINT_PROGRESS_TIMEOUT';
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (isProgressBackendIncompatibility(message)) {
        return 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE';
    }
    return 'BLUEPRINT_PROGRESS_READ_FAILED';
}

function isProgressProtocolIncompatibility(code: string): boolean {
    return code === 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE' || code === 'BLUEPRINT_EXECUTION_PROTOCOL_INCOMPATIBLE';
}

function hasErrorName(error: unknown, name: string): boolean {
    if (typeof error !== 'object' || error === null || !('name' in error)) return false;
    return (error as { name?: unknown }).name === name;
}

function isCurrentTransportHealth(
    health: ProgressTransportHealth | undefined,
    runId: string | undefined
): health is ProgressTransportHealth {
    return health !== undefined && health.runId === runId;
}

function isTransportHealthRecentAt(
    health: ProgressTransportHealth | undefined,
    runId: string | undefined,
    issueTime: number,
    currentTime: number
): boolean {
    if (!isCurrentTransportHealth(health, runId)) return false;
    const ageAtIssue = issueTime - health.confirmedAt;
    const currentAge = currentTime - health.confirmedAt;
    return (
        ageAtIssue <= progressTransportHealthMaxAgeMs &&
        currentAge >= 0 &&
        currentAge <= progressTransportHealthMaxAgeMs
    );
}

function isExpiredTransportHealth(
    health: ProgressTransportHealth | undefined,
    runId: string | undefined,
    now: number
): boolean {
    if (!isCurrentTransportHealth(health, runId)) return false;
    const age = now - health.confirmedAt;
    return age < 0 || age > progressTransportHealthMaxAgeMs;
}

function isProgressBackendIncompatibility(message: string): boolean {
    if (
        /could not find public function|function[^\n]*(?:not found|does not exist)|no public function|not a public function/i.test(
            message
        )
    ) {
        return true;
    }

    const normalized = message.replace(/\s+/g, ' ');
    const mentionsProtocolVersion = /\bprotocolVersion\b/i.test(normalized);
    const isValidatorFailure =
        /argument ?validation ?error|value does not match validator|validator rejected|missing the required field/i.test(
            normalized
        );
    const isExplicitVersionMismatch =
        /(?:protocolVersion|protocol version).{0,120}(?:mismatch|incompatible|unsupported|expected)|(?:mismatch|incompatible|unsupported|expected).{0,120}(?:protocolVersion|protocol version)/i.test(
            normalized
        );

    return mentionsProtocolVersion && (isValidatorFailure || isExplicitVersionMismatch);
}

function isAuthenticationError(error: unknown): boolean {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return /(?:authentication|authorization) required|unauthorized|\b401\b/i.test(message);
}

function readJwtExpiration(token: string): number | undefined {
    const payload = token.split('.')[1];
    if (!payload) return undefined;

    try {
        const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
        const value = JSON.parse(globalThis.atob(padded)) as { exp?: unknown };
        return typeof value.exp === 'number' && Number.isFinite(value.exp) ? value.exp * 1000 : undefined;
    } catch {
        return undefined;
    }
}
