// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDashboardGuildCatalogQueryKey } from '../dashboard-query-keys.js';
import { useDashboardGuildCatalog } from './dashboard-guild-catalog.js';

type CatalogLiveState = {
    updatedAt: string;
    version: number;
};

const convexMock = vi.hoisted(() => {
    let onUpdate: (() => void) | undefined;
    let state: CatalogLiveState | undefined;

    return {
        client: {
            close: vi.fn(() => Promise.resolve()),
            setAuth: vi.fn(),
            watchQuery: vi.fn(() => ({
                localQueryResult: () => state,
                onUpdate: (callback: () => void) => {
                    onUpdate = callback;
                    return vi.fn();
                },
            })),
        },
        publish(nextState: CatalogLiveState) {
            state = nextState;
            onUpdate?.();
        },
        reset() {
            onUpdate = undefined;
            state = undefined;
        },
    };
});

vi.mock('convex/react', () => ({
    ConvexReactClient: function MockConvexReactClient() {
        return convexMock.client;
    },
}));

vi.mock('./dashboard-live-activity.js', () => ({
    useDashboardLiveTransportActive: () => true,
}));

afterEach(() => {
    convexMock.reset();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('dashboard guild catalog live refresh', () => {
    it('invalidates the shared catalog after an installation revision changes', () => {
        vi.stubEnv('VITE_CONVEX_URL', 'https://neonflux.convex.cloud');
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
        const view = render(
            <QueryClientProvider client={queryClient}>
                <CatalogHarness />
            </QueryClientProvider>
        );

        act(() => {
            convexMock.publish({ updatedAt: '2026-07-13T10:00:00.000Z', version: 1 });
        });
        expect(invalidateQueries).not.toHaveBeenCalled();

        act(() => {
            convexMock.publish({ updatedAt: '2026-07-13T10:00:01.000Z', version: 2 });
        });
        expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
            queryKey: getDashboardGuildCatalogQueryKey(),
        });

        view.unmount();
    });
});

function CatalogHarness(): ReactNode {
    useDashboardGuildCatalog({
        guilds: [{ id: 'guild-1', name: 'Guild One' }],
        mode: 'multi',
    });
    return null;
}
