import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { ConvexHttpClient } from 'convex/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    getDashboardBlueprintRunProgressQueryKey,
    getDashboardBlueprintBackupsQueryKey,
    getDashboardBlueprintRunsQueryKey,
    getDashboardBlueprintStatusQueryKey,
} from '../dashboard-query-keys.js';
import { createDashboardRequestDeadline, settleDashboardRequestWithAbort } from '../dashboard-request-deadline.js';
import type { DashboardRequestDeadline } from '../dashboard-request-deadline.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../dashboard-blueprint-run-protocol.js';
import { dashboardBlueprintRunPhases } from '../server/dashboard-blueprint-contracts.js';
import type { DashboardBlueprintRunProgress } from '../server/dashboard-blueprint-contracts.js';
import { fetchDashboardConvexToken, readDashboardConvexUrl, useDashboardLive } from './dashboard-live-provider.js';
import { isTerminalDashboardBlueprintRun, mergeDashboardBlueprintRunProgress } from './dashboard-blueprint-progress.js';

const progressPollIntervalMs = 4_000;
const progressPollRequestTimeoutMs = 10_000;
const progressPollStaleTimeMs = 1_500;
const progressTokenRequestTimeoutMs = 6_000;
const progressTransportHealthMaxAgeMs = 12_000;
const progressWatchTimeoutMs = 12_000;
const progressTokenRefreshWindowMs = 30_000;
const progressTokenFallbackLifetimeMs = 60_000;
const runStatuses = new Set<DashboardBlueprintRunProgress['status']>([
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
    planId: string;
};

type ProgressCache = {
    run: DashboardBlueprintRunProgress | null;
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
    planId: string;
};

export type DashboardBlueprintProgressTransport = {
    mode: 'idle' | 'live' | 'polling' | 'reconnecting' | 'incompatible' | 'unavailable';
    confirmedAt?: number;
};

export function useDashboardBlueprintRunProgress({
    guildId,
    planId,
    initialRun,
}: {
    guildId: string;
    planId: string | undefined;
    initialRun: DashboardBlueprintRunProgress | undefined;
}) {
    const queryClient = useQueryClient();
    const { client: liveClient, restart: restartLiveTransport } = useDashboardLive();
    const [watchAttempt, setWatchAttempt] = useState(0);
    const [watchIssue, setWatchIssue] = useState<ProgressIssue>();
    const [liveHealth, setLiveHealth] = useState<ProgressTransportHealth>();
    const [pollHealth, setPollHealth] = useState<ProgressTransportHealth>();
    const [retrying, setRetrying] = useState(false);
    const progressTokenRef = useRef<ProgressToken | undefined>(undefined);
    const progressTokenRequestRef = useRef<ProgressTokenRequest | undefined>(undefined);
    const retryRequestRef = useRef<Promise<unknown> | undefined>(undefined);
    const terminalRefreshRunIdRef = useRef<string | undefined>(undefined);
    const confirmPollHealth = useCallback((confirmedPlanId: string) => {
        setPollHealth({ confirmedAt: Date.now(), planId: confirmedPlanId });
    }, []);
    const convexUrl = readDashboardConvexUrl();
    const queryKey = useMemo(
        () => getDashboardBlueprintRunProgressQueryKey(guildId, planId ?? 'none'),
        [guildId, planId]
    );
    // Transport configuration and the short-lived auth cache do not change the guild/run query identity.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const progressQuery = useQuery<ProgressCache>({
        queryKey,
        queryFn: async ({ signal }) => {
            if (!convexUrl || !planId) {
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
                    client.query(api.blueprint.findBlueprintRunProgressForGuild, {
                        guildId,
                        protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                        planId: planId as Id<'blueprintPlans'>,
                    }),
                    deadline.signal
                );
                const run = toDashboardRunProgress(result);
                confirmPollHealth(planId);
                return {
                    run,
                };
            } catch (error) {
                if (isAuthenticationError(error)) progressTokenRef.current = undefined;
                throw error;
            } finally {
                deadline.dispose();
            }
        },
        enabled: Boolean(convexUrl && planId),
        initialData: { run: initialRun ?? null },
        initialDataUpdatedAt: 0,
        refetchInterval: (query) => {
            if (query.state.error && isProgressProtocolIncompatibility(progressIssueCode(query.state.error))) {
                return false;
            }
            const { run } = query.state.data ?? { run: null };
            return run && isTerminalDashboardBlueprintRun(run) ? false : progressPollIntervalMs;
        },
        refetchIntervalInBackground: false,
        refetchOnReconnect: 'always',
        refetchOnWindowFocus: 'always',
        retry: (failureCount, error) => {
            const code = progressIssueCode(error);
            return (
                code !== 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE' &&
                code !== 'BLUEPRINT_RUN_PROTOCOL_INCOMPATIBLE' &&
                code !== 'BLUEPRINT_PROGRESS_TIMEOUT' &&
                failureCount < 2
            );
        },
        retryDelay: (failureCount) => Math.min(100 * 2 ** failureCount, 1_000),
        staleTime: progressPollStaleTimeMs,
        structuralSharing: (previous, incoming) =>
            mergeProgressCache(previous as ProgressCache | undefined, incoming as ProgressCache),
    });
    const run = progressQuery.data.run;
    const terminal = run ? isTerminalDashboardBlueprintRun(run) : false;

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
        if (!planId || !initialRun) return;
        queryClient.setQueryData<ProgressCache>(queryKey, (current) =>
            mergeProgressCache(current, { run: initialRun })
        );
    }, [initialRun, queryClient, queryKey, planId]);

    useEffect(() => {
        const currentHealth = [liveHealth, pollHealth].filter(
            (health): health is ProgressTransportHealth =>
                health !== undefined && planId !== undefined && health.planId === planId
        );
        if (currentHealth.length === 0) return undefined;

        const nextExpiry = Math.min(
            ...currentHealth.map((health) => health.confirmedAt + progressTransportHealthMaxAgeMs)
        );
        const timeout = setTimeout(
            () => {
                const now = Date.now();
                setLiveHealth((current) => (isExpiredTransportHealth(current, planId, now) ? undefined : current));
                setPollHealth((current) => (isExpiredTransportHealth(current, planId, now) ? undefined : current));
            },
            Math.max(0, nextExpiry - Date.now()) + 1
        );

        return () => clearTimeout(timeout);
    }, [liveHealth, pollHealth, planId]);

    useEffect(() => {
        if (!planId || terminal || !liveClient) return undefined;

        const activePlanId = planId;
        let active = true;
        let receivedResult = false;
        let unsubscribe: () => void = () => undefined;
        let watch: ReturnType<typeof liveClient.watchQuery> | undefined;
        const timeout = setTimeout(() => {
            if (!receivedResult) recordWatchIssue('BLUEPRINT_PROGRESS_TIMEOUT');
        }, progressWatchTimeoutMs);

        function recordWatchIssue(code: string): void {
            if (!active) return;
            setLiveHealth((current) => (current?.planId === activePlanId ? undefined : current));
            setWatchIssue((current) =>
                current?.code === code && current.planId === activePlanId
                    ? current
                    : { at: Date.now(), code, planId: activePlanId }
            );
        }

        function readProgress(): void {
            if (!active) return;
            try {
                const result = watch?.localQueryResult();
                if (result === undefined) return;
                receivedResult = true;
                clearTimeout(timeout);
                const incoming = toDashboardRunProgress(result);
                queryClient.setQueryData<ProgressCache>(queryKey, (current) =>
                    mergeProgressCache(current, {
                        run: incoming,
                    })
                );
                setLiveHealth({ confirmedAt: Date.now(), planId: activePlanId });
                setWatchIssue(undefined);
            } catch (error) {
                clearTimeout(timeout);
                recordWatchIssue(progressIssueCode(error));
            }
        }

        try {
            watch = liveClient.watchQuery(api.blueprint.findBlueprintRunProgressForGuild, {
                guildId,
                protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                planId: activePlanId as Id<'blueprintPlans'>,
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
        };
    }, [guildId, liveClient, queryClient, queryKey, planId, terminal, watchAttempt]);

    useEffect(() => {
        if (!run || !isTerminalDashboardBlueprintRun(run)) return;
        if (terminalRefreshRunIdRef.current === run.id) return;

        terminalRefreshRunIdRef.current = run.id;
        void Promise.all([
            queryClient.invalidateQueries({ queryKey: getDashboardBlueprintStatusQueryKey(guildId) }),
            queryClient.invalidateQueries({ queryKey: getDashboardBlueprintRunsQueryKey(guildId) }),
            queryClient.invalidateQueries({ queryKey: getDashboardBlueprintBackupsQueryKey(guildId) }),
        ]);
    }, [run, guildId, queryClient]);

    const pollIssue = progressQuery.isError
        ? {
              at: progressQuery.errorUpdatedAt,
              code: progressIssueCode(progressQuery.error),
              planId: planId ?? 'none',
          }
        : undefined;
    // The expiry timer wakes the UI, but background-tab throttling can delay it. Re-check wall-clock freshness
    // whenever React renders so an old confirmation never suppresses a current transport failure.
    // eslint-disable-next-line react-hooks/purity
    const healthCheckedAt = Date.now();
    const activeWatchIssue =
        watchIssue &&
        watchIssue.planId === planId &&
        (isProgressProtocolIncompatibility(watchIssue.code) ||
            !isTransportHealthRecentAt(pollHealth, planId, watchIssue.at, healthCheckedAt))
            ? watchIssue
            : undefined;
    const activePollIssue =
        pollIssue &&
        (isProgressProtocolIncompatibility(pollIssue.code) ||
            !isTransportHealthRecentAt(liveHealth, planId, pollIssue.at, healthCheckedAt))
            ? pollIssue
            : undefined;
    const activeIssues = [activeWatchIssue, activePollIssue].filter(
        (issue): issue is ProgressIssue => issue !== undefined
    );
    const issueCode: string | undefined = activeIssues.some(
        (issue) => issue.code === 'BLUEPRINT_RUN_PROTOCOL_INCOMPATIBLE'
    )
        ? 'BLUEPRINT_RUN_PROTOCOL_INCOMPATIBLE'
        : activeIssues.some((issue) => issue.code === 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE')
          ? 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE'
          : activeIssues.reduce<ProgressIssue | undefined>(
                (latest, issue) => (!latest || issue.at > latest.at ? issue : latest),
                undefined
            )?.code;

    const effectiveIssueCode = planId && !convexUrl ? 'BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE' : issueCode;
    const liveHealthy =
        isCurrentTransportHealth(liveHealth, planId) && !isExpiredTransportHealth(liveHealth, planId, healthCheckedAt);
    const pollHealthy =
        isCurrentTransportHealth(pollHealth, planId) && !isExpiredTransportHealth(pollHealth, planId, healthCheckedAt);
    const confirmedAt = Math.max(liveHealthy ? liveHealth.confirmedAt : 0, pollHealthy ? pollHealth.confirmedAt : 0);
    const transport: DashboardBlueprintProgressTransport = {
        mode: !planId
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
        run,
        issueCode: effectiveIssueCode,
        retrying,
        transport,
        retry: () => {
            if (retryRequestRef.current || !convexUrl || !planId) return;

            const tokenRequest = progressTokenRequestRef.current;
            progressTokenRequestRef.current = undefined;
            tokenRequest?.deadline.abort();
            setRetrying(true);
            setLiveHealth(undefined);
            setPollHealth(undefined);
            setWatchIssue(undefined);
            restartLiveTransport();
            setWatchAttempt((current) => current + 1);
            const retryRequest = progressQuery.refetch({ cancelRefetch: true });
            retryRequestRef.current = retryRequest;
            void retryRequest.finally(() => {
                if (retryRequestRef.current === retryRequest) retryRequestRef.current = undefined;
                setRetrying(false);
            });
        },
    };
}

type BlueprintRunProgressQueryResult = {
    appliedSteps: number;
    completedAt?: string;
    createdAt: string;
    currentStepLabel?: string;
    errorType?: string;
    failedSteps: number;
    id: string;
    phase: string;
    protocolVersion: number;
    retryAt?: string;
    skippedSteps: number;
    startedAt?: string;
    status: string;
    totalSteps: number;
    updatedAt: string;
};

function toDashboardRunProgress(result: BlueprintRunProgressQueryResult | null): DashboardBlueprintRunProgress | null {
    if (!result) return null;
    if (result.protocolVersion !== BLUEPRINT_RUN_PROTOCOL_VERSION) {
        throw new DashboardProgressReadError('BLUEPRINT_RUN_PROTOCOL_INCOMPATIBLE');
    }
    if (!runStatuses.has(result.status as DashboardBlueprintRunProgress['status'])) {
        throw new Error('invalid-blueprint-run-status');
    }
    if (!dashboardBlueprintRunPhases.includes(result.phase as DashboardBlueprintRunProgress['phase'])) {
        throw new Error('invalid-blueprint-run-phase');
    }

    return {
        id: result.id,
        protocolVersion: result.protocolVersion,
        status: result.status as DashboardBlueprintRunProgress['status'],
        phase: result.phase as DashboardBlueprintRunProgress['phase'],
        completedSteps: result.appliedSteps + result.failedSteps + result.skippedSteps,
        failedSteps: result.failedSteps,
        totalSteps: result.totalSteps,
        ...(result.currentStepLabel ? { currentStepLabel: result.currentStepLabel } : {}),
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
        run: mergeDashboardBlueprintRunProgress(previous?.run, incoming.run),
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
    return code === 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE' || code === 'BLUEPRINT_RUN_PROTOCOL_INCOMPATIBLE';
}

function hasErrorName(error: unknown, name: string): boolean {
    if (typeof error !== 'object' || error === null || !('name' in error)) return false;
    return (error as { name?: unknown }).name === name;
}

function isCurrentTransportHealth(
    health: ProgressTransportHealth | undefined,
    planId: string | undefined
): health is ProgressTransportHealth {
    return health !== undefined && health.planId === planId;
}

function isTransportHealthRecentAt(
    health: ProgressTransportHealth | undefined,
    planId: string | undefined,
    issueTime: number,
    currentTime: number
): boolean {
    if (!isCurrentTransportHealth(health, planId)) return false;
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
    planId: string | undefined,
    now: number
): boolean {
    if (!isCurrentTransportHealth(health, planId)) return false;
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
