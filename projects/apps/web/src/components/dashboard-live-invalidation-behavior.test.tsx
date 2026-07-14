// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardLiveArea } from '../dashboard-live.js';
import { getDashboardStructureQueryKey } from '../dashboard-query-keys.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';

type LiveState = {
    area: DashboardLiveArea;
    guildId: string;
    updatedAt: string;
    version: number;
};

const convexMock = vi.hoisted(() => {
    let onUpdate: (() => void) | undefined;
    let states: LiveState[] = [];

    return {
        client: {
            watchQuery: vi.fn(() => ({
                localQueryResult: () => states,
                onUpdate: (callback: () => void) => {
                    onUpdate = callback;
                    return vi.fn();
                },
            })),
        },
        publish(nextStates: LiveState[]) {
            states = nextStates;
            onUpdate?.();
        },
        reset() {
            onUpdate = undefined;
            states = [];
        },
    };
});

vi.mock('./dashboard-live-provider.js', () => ({
    readDashboardConvexUrl: () => 'https://neonflux.convex.cloud',
    useDashboardLive: () => ({
        client: convexMock.client,
        confirmManageableGuildScope: vi.fn(),
        restart: vi.fn(),
        status: { authentication: 'authenticated', generation: 1, phase: 'connected' },
    }),
}));

vi.mock('./dashboard-live-activity.js', () => ({
    useDashboardLiveTransportActive: () => true,
}));

afterEach(() => {
    convexMock.reset();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('dashboard live invalidation', () => {
    it('deduplicates simultaneous terminal structure signals into one canonical workspace refresh', () => {
        vi.stubEnv('VITE_CONVEX_URL', 'https://neonflux.convex.cloud');
        const queryClient = new QueryClient();
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

        const view = render(
            <QueryClientProvider client={queryClient}>
                <LiveInvalidationHarness areas={['structure', 'import_export']} />
            </QueryClientProvider>
        );

        act(() => {
            convexMock.publish([
                { area: 'structure', guildId: 'guild-1', updatedAt: '2026-07-12T12:00:00.000Z', version: 1 },
                { area: 'import_export', guildId: 'guild-1', updatedAt: '2026-07-12T12:00:00.000Z', version: 1 },
            ]);
        });

        expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
            queryKey: getDashboardStructureQueryKey('guild-1'),
        });
        view.unmount();
    });
});

function LiveInvalidationHarness({ areas }: { areas: readonly DashboardLiveArea[] }): ReactNode {
    useDashboardLiveInvalidation({ areas, guildId: 'guild-1' });
    return null;
}
