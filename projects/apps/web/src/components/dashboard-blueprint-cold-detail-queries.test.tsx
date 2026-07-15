// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    readDashboardBlueprintPlanAuthorityRouteData,
    readDashboardBlueprintPreflightEvidenceRouteData,
    readDashboardBlueprintVerificationEvidenceRouteData,
} from '../server/dashboard-blueprint-route-data.js';
import {
    mergeDashboardBlueprintPlanColdDetail,
    useDashboardBlueprintPlanAuthorityQuery,
    useDashboardBlueprintPreflightEvidenceQuery,
    useDashboardBlueprintVerificationEvidenceQuery,
} from './dashboard-blueprint-cold-detail-queries.js';
import {
    emptyDashboardBlueprintConfirmation,
    readDashboardBlueprintDeployReadiness,
} from './dashboard-blueprint-deploy-readiness.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';

vi.mock('../server/dashboard-blueprint-route-data.js', () => ({
    readDashboardBlueprintPlanAuthorityRouteData: vi.fn(),
    readDashboardBlueprintPreflightEvidenceRouteData: vi.fn(),
    readDashboardBlueprintVerificationEvidenceRouteData: vi.fn(),
}));

describe('Blueprint cold detail queries', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('deduplicates enabled cold reads across rerenders and never reads hidden evidence', async () => {
        vi.mocked(readDashboardBlueprintPlanAuthorityRouteData).mockResolvedValue({
            type: 'plan-authority',
            plan: { id: 'plan-1' },
        } as never);
        vi.mocked(readDashboardBlueprintPreflightEvidenceRouteData).mockResolvedValue({
            type: 'preflight-evidence',
            preflightId: 'preflight-1',
            report: { summary: {} },
        } as never);
        vi.mocked(readDashboardBlueprintVerificationEvidenceRouteData).mockResolvedValue({
            type: 'verification-evidence',
            verification: { status: 'matched' },
        } as never);
        const client = queryClient();
        const view = renderColdQueries(client, {
            authority: true,
            evidence: true,
            verification: true,
        });
        await waitFor(() => expect(screen.getByTestId('cold-state').textContent).toContain('plan-1|evidence|matched'));
        view.rerender(element(client, { authority: true, evidence: true, verification: true }));
        expect(readDashboardBlueprintPlanAuthorityRouteData).toHaveBeenCalledOnce();
        expect(readDashboardBlueprintPreflightEvidenceRouteData).toHaveBeenCalledOnce();
        expect(readDashboardBlueprintVerificationEvidenceRouteData).toHaveBeenCalledOnce();

        view.rerender(element(client, { authority: false, evidence: false, verification: false }));
        await act(async () => Promise.resolve());
        expect(readDashboardBlueprintPlanAuthorityRouteData).toHaveBeenCalledOnce();
        expect(readDashboardBlueprintPreflightEvidenceRouteData).toHaveBeenCalledOnce();
        expect(readDashboardBlueprintVerificationEvidenceRouteData).toHaveBeenCalledOnce();
        view.unmount();
    });

    it('automatically retries once and does not enter a render or focus retry loop', async () => {
        vi.mocked(readDashboardBlueprintPlanAuthorityRouteData).mockRejectedValue(new Error('unavailable'));
        const client = queryClient();
        const view = renderColdQueries(client, { authority: true });
        await waitFor(() => expect(screen.getByTestId('cold-state').textContent).toContain('authority-error'));
        expect(readDashboardBlueprintPlanAuthorityRouteData).toHaveBeenCalledTimes(2);
        view.rerender(element(client, { authority: true }));
        window.dispatchEvent(new Event('focus'));
        await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
        expect(readDashboardBlueprintPlanAuthorityRouteData).toHaveBeenCalledTimes(2);
        view.unmount();
    });

    it('fences a late plan response behind the exact guild and plan query key', async () => {
        const first = deferred<unknown>();
        const second = deferred<unknown>();
        vi.mocked(readDashboardBlueprintPlanAuthorityRouteData)
            .mockReturnValueOnce(first.promise as never)
            .mockReturnValueOnce(second.promise as never);
        const client = queryClient();
        const view = render(
            <QueryClientProvider client={client}>
                <AuthorityOnly guildId='guild-1' planId='plan-1' />
            </QueryClientProvider>
        );
        view.rerender(
            <QueryClientProvider client={client}>
                <AuthorityOnly guildId='guild-2' planId='plan-2' />
            </QueryClientProvider>
        );
        await act(async () => second.resolve({ type: 'plan-authority', plan: { id: 'plan-2' } }));
        await waitFor(() => expect(screen.getByTestId('authority-id').textContent).toBe('plan-2'));
        await act(async () => first.resolve({ type: 'plan-authority', plan: { id: 'plan-1' } }));
        expect(screen.getByTestId('authority-id').textContent).toBe('plan-2');
        view.unmount();
    });

    it('keeps only immutable cold detail fields from the authority response', async () => {
        vi.mocked(readDashboardBlueprintPlanAuthorityRouteData).mockResolvedValue({
            type: 'plan-authority',
            plan: {
                ...createPlan({ status: 'review_ready', updatedAt: '2026-07-15T10:00:00.000Z' }),
                requestedSnapshotStoredAt: '2026-07-15T09:00:00.000Z',
            },
        });
        const client = queryClient();
        const view = render(
            <QueryClientProvider client={client}>
                <AuthorityPayload />
            </QueryClientProvider>
        );

        await waitFor(() =>
            expect(JSON.parse(screen.getByTestId('authority-payload').textContent)).toEqual({
                id: 'plan-1',
                requestedSnapshotStoredAt: '2026-07-15T09:00:00.000Z',
            })
        );
        view.unmount();
    });

    it('preserves fresh approved metadata when Deploy and Compare merge a cached review authority', () => {
        const livePlan = createPlan({ status: 'approved', updatedAt: '2026-07-15T11:00:00.000Z' });
        const cachedAuthority = {
            id: livePlan.id,
            requestedSnapshotStoredAt: '2026-07-15T09:00:00.000Z',
            status: 'review_ready',
            updatedAt: '2026-07-15T10:00:00.000Z',
        };

        const deployPlan = mergeDashboardBlueprintPlanColdDetail(livePlan, cachedAuthority);
        const comparePlan = mergeDashboardBlueprintPlanColdDetail(livePlan, cachedAuthority);

        for (const mergedPlan of [deployPlan, comparePlan]) {
            expect(mergedPlan).toMatchObject({
                status: 'approved',
                updatedAt: '2026-07-15T11:00:00.000Z',
                requestedSnapshotStoredAt: '2026-07-15T09:00:00.000Z',
            });
        }
        expect(
            readDashboardBlueprintDeployReadiness({
                confirmation: emptyDashboardBlueprintConfirmation,
                now: Date.parse('2026-07-15T11:00:00.000Z'),
                plan: deployPlan,
                preflightReport: {
                    summary: {
                        total: 1,
                        ready: 1,
                        stale: 0,
                        mappingRequired: 0,
                        destructiveApprovalRequired: 0,
                        unsupported: 0,
                        invalidPlan: 0,
                    },
                    steps: [
                        {
                            planStepId: 'step-1',
                            actionType: 'create',
                            targetType: 'channel',
                            status: 'ready',
                            message: 'Ready.',
                        },
                    ],
                    checkedAt: '2026-07-15T10:59:00.000Z',
                    expiresAt: '2026-07-15T12:00:00.000Z',
                },
                targetGuildName: 'Target guild',
            }).nextAction
        ).toBe('apply');
    });
});

function ColdQueries(input: { authority?: boolean; evidence?: boolean; verification?: boolean }) {
    const authority = useDashboardBlueprintPlanAuthorityQuery({
        enabled: Boolean(input.authority),
        guildId: 'guild-1',
        planId: 'plan-1',
    });
    const evidence = useDashboardBlueprintPreflightEvidenceQuery({
        enabled: Boolean(input.evidence),
        guildId: 'guild-1',
        preflightId: 'preflight-1',
    });
    const verification = useDashboardBlueprintVerificationEvidenceQuery({
        enabled: Boolean(input.verification),
        guildId: 'guild-1',
        runId: 'run-1',
    });
    return (
        <div data-testid='cold-state'>
            {authority.isError ? 'authority-error' : ((authority.data as { id?: string } | undefined)?.id ?? '')}|
            {evidence.isError ? 'evidence-error' : evidence.data ? 'evidence' : ''}|
            {verification.isError
                ? 'verification-error'
                : ((verification.data as { status?: string } | undefined)?.status ?? '')}
        </div>
    );
}

function AuthorityOnly(input: { guildId: string; planId: string }) {
    const query = useDashboardBlueprintPlanAuthorityQuery({ enabled: true, ...input });
    return <div data-testid='authority-id'>{(query.data as { id?: string } | undefined)?.id ?? ''}</div>;
}

function AuthorityPayload() {
    const query = useDashboardBlueprintPlanAuthorityQuery({ enabled: true, guildId: 'guild-1', planId: 'plan-1' });
    return <div data-testid='authority-payload'>{JSON.stringify(query.data ?? {})}</div>;
}

function element(client: QueryClient, input: { authority?: boolean; evidence?: boolean; verification?: boolean }) {
    return (
        <QueryClientProvider client={client}>
            <ColdQueries {...input} />
        </QueryClientProvider>
    );
}

function renderColdQueries(
    client: QueryClient,
    input: { authority?: boolean; evidence?: boolean; verification?: boolean }
) {
    return render(element(client, input));
}

function queryClient() {
    return new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createPlan(input: Pick<DashboardBlueprintPlan, 'status' | 'updatedAt'>): DashboardBlueprintPlan {
    return {
        id: 'plan-1',
        status: input.status,
        createdAt: '2026-07-15T09:00:00.000Z',
        updatedAt: input.updatedAt,
        summary: { creates: 1, updates: 0, deletes: 0, roles: 0, categories: 0, channels: 1 },
        changeCount: 1,
        planStepCount: 1,
        planBlockerCount: 0,
        steps: [],
        policy: 'synchronize',
        decisionSummary: {
            'no-op': 0,
            create: 1,
            update: 0,
            delete: 0,
            'unmanaged-retained': 0,
            'protected-retained': 0,
            'protected-omitted': 0,
            'blocked-ambiguous': 0,
            'blocked-unsupported': 0,
        },
        decisions: [],
        planDigest: 'plan-digest',
        deleteStepCount: 0,
    };
}
