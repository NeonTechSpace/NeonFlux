import { describe, expect, it } from 'vitest';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import {
    canStartNewBlueprintDeployment,
    deriveDashboardBlueprintDeployJourney,
    isDashboardBlueprintSourceReady,
} from './dashboard-blueprint-deploy-stage.js';

describe('deriveDashboardBlueprintDeployJourney', () => {
    it('uses the canonical Blueprint parser before leaving Source', () => {
        expect(isDashboardBlueprintSourceReady('{"roles":[{}],"categories":[],"channels":[]}')).toBe(false);
        expect(isDashboardBlueprintSourceReady('{"version":1,"roles":[],"categories":[],"channels":[]}')).toBe(true);
    });

    it.each(['draft', 'needs_input', 'review_ready'] as const)('keeps a %s plan in review', (status) => {
        expect(
            deriveDashboardBlueprintDeployJourney({
                draftStep: undefined,
                hasParsedSource: false,
                plan: { status } as DashboardBlueprintPlan,
                preflight: undefined,
            })
        ).toEqual({ index: 3, step: 'review' });
    });

    it('treats a run as authoritative over an older plan status', () => {
        const run = {
            status: 'approved',
            run: {
                id: 'run-1',
                protocolVersion: 1,
                status: 'queued',
                phase: 'queued',
                completedSteps: 0,
                failedSteps: 0,
                totalSteps: 4,
                createdAt: '2026-07-12T10:00:00.000Z',
                updatedAt: '2026-07-12T10:00:00.000Z',
            },
        } as DashboardBlueprintPlan;

        expect(
            deriveDashboardBlueprintDeployJourney({
                draftStep: undefined,
                hasParsedSource: false,
                plan: run,
                preflight: undefined,
            })
        ).toEqual({ index: 6, step: 'deploy' });
    });

    it('moves an approved plan through Safety and Confirm from durable preflight state', () => {
        const plan = { status: 'approved' } as DashboardBlueprintPlan;
        expect(
            deriveDashboardBlueprintDeployJourney({
                draftStep: undefined,
                hasParsedSource: false,
                plan,
                preflight: undefined,
            }).step
        ).toBe('safety');
        expect(
            deriveDashboardBlueprintDeployJourney({
                draftStep: undefined,
                hasParsedSource: false,
                plan,
                preflight: { status: 'ready' },
            }).step
        ).toBe('confirm');
    });

    it('returns an expired ready preflight to Safety', () => {
        expect(
            deriveDashboardBlueprintDeployJourney({
                draftStep: undefined,
                hasParsedSource: false,
                now: Date.parse('2026-07-15T10:00:00.000Z'),
                plan: { status: 'approved' } as DashboardBlueprintPlan,
                preflight: {
                    status: 'ready',
                    expiresAt: '2026-07-15T09:59:59.000Z',
                },
            })
        ).toEqual({ index: 4, step: 'safety' });
    });

    it('resumes a safely stopped plan only after a newer preflight', () => {
        const plan = {
            status: 'approved',
            run: {
                status: 'failed_before_mutation',
                updatedAt: '2026-07-15T10:00:00.000Z',
            },
        } as DashboardBlueprintPlan;
        const base = {
            draftStep: undefined,
            hasParsedSource: false,
            now: Date.parse('2026-07-15T10:02:00.000Z'),
            plan,
        };

        expect(
            deriveDashboardBlueprintDeployJourney({
                ...base,
                preflight: { checkedAt: '2026-07-15T09:59:00.000Z', status: 'ready' },
            }).step
        ).toBe('deploy');
        expect(
            deriveDashboardBlueprintDeployJourney({
                ...base,
                preflight: {
                    checkedAt: '2026-07-15T10:01:00.000Z',
                    expiresAt: '2026-07-15T10:05:00.000Z',
                    status: 'ready',
                },
            }).step
        ).toBe('confirm');
        expect(
            deriveDashboardBlueprintDeployJourney({
                ...base,
                preflight: { checkedAt: '2026-07-15T10:01:00.000Z', status: 'blocked' },
            }).step
        ).toBe('safety');
    });

    it.each(['queued', 'running', 'paused', 'partially_applied', 'needs_reconciliation', 'outcome_unknown'] as const)(
        'does not allow a new source while a run is %s',
        (status) => {
            const run = {
                run: { status },
            } as DashboardBlueprintPlan;

            expect(canStartNewBlueprintDeployment(run)).toBe(false);
        }
    );

    it.each(['succeeded', 'failed_before_mutation', 'cancelled'] as const)(
        'allows a new source after a run is %s',
        (status) => {
            const run = {
                run: { status },
            } as DashboardBlueprintPlan;

            expect(canStartNewBlueprintDeployment(run)).toBe(true);
        }
    );
});
