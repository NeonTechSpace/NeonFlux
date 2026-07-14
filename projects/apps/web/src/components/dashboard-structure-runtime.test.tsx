// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardStructureRuntime } from './dashboard-structure-runtime.js';

const routerHarness = vi.hoisted(() => ({
    navigate: vi.fn(() => Promise.resolve()),
    state: {
        isLoading: false,
        location: { pathname: '/dashboard/guild-1/structure/current' },
        resolvedLocation: { pathname: '/dashboard/guild-1/structure/current' },
    },
}));

vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({ data: undefined, error: undefined, isFetching: false, refetch: vi.fn() }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@tanstack/react-router', async () => {
    const { createElement } = await import('react');
    const { useDashboardStructureRuntime } = await import('./dashboard-structure-runtime-context.js');

    return {
        Link: ({
            to,
            params,
            children,
            activeProps: _activeProps,
            ...props
        }: {
            to: string;
            params: { guildId: string };
            children: ReactNode | ((state: { isActive: boolean }) => ReactNode);
            activeProps?: unknown;
        }) =>
            createElement(
                'a',
                { ...props, href: to.replace('$guildId', params.guildId) },
                typeof children === 'function' ? children({ isActive: false }) : children
            ),
        Outlet: () => {
            const runtime = useDashboardStructureRuntime();
            return createElement('input', {
                'aria-label': 'Blueprint import draft',
                value: runtime.importJson,
                onChange: (event: { currentTarget: { value: string } }) =>
                    runtime.setImportJson(event.currentTarget.value),
            });
        },
        useNavigate: () => routerHarness.navigate,
        useRouterState: ({ select }: { select: (state: typeof routerHarness.state) => unknown }) =>
            select(routerHarness.state),
    };
});

vi.mock('./dashboard-live-invalidation.js', () => ({
    useDashboardLiveInvalidation: () => undefined,
}));

vi.mock('./dashboard-structure-execution-progress.js', () => ({
    useDashboardStructureExecutionProgress: () => ({
        execution: undefined,
        issueCode: undefined,
        retry: vi.fn(),
        retrying: false,
        transport: { mode: 'idle' },
    }),
}));

describe('DashboardStructureRuntime', () => {
    beforeEach(() => {
        routerHarness.navigate.mockClear();
        routerHarness.state = {
            isLoading: false,
            location: { pathname: '/dashboard/guild-1/structure/current' },
            resolvedLocation: { pathname: '/dashboard/guild-1/structure/current' },
        };
    });

    it('keeps its draft while history or programmatic navigation shows the target leaf island', () => {
        const view = render(<DashboardStructureRuntime guildId='guild-1' />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Blueprint import draft' }), {
            target: { value: '{"draft":true}' },
        });

        routerHarness.state = {
            isLoading: true,
            location: { pathname: '/dashboard/guild-1/structure/backups' },
            resolvedLocation: { pathname: '/dashboard/guild-1/structure/current' },
        };
        view.rerender(<DashboardStructureRuntime guildId='guild-1' />);

        expect(screen.getByRole('heading', { level: 2, name: 'Protected versions' })).toBeTruthy();
        expect(screen.getByRole('status', { name: 'Loading server blueprint data' })).toBeTruthy();
        expect(screen.queryByRole('textbox', { name: 'Blueprint import draft' })).toBeNull();

        routerHarness.state = {
            isLoading: false,
            location: { pathname: '/dashboard/guild-1/structure/backups' },
            resolvedLocation: { pathname: '/dashboard/guild-1/structure/backups' },
        };
        view.rerender(<DashboardStructureRuntime guildId='guild-1' />);

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Blueprint import draft' }).value).toBe(
            '{"draft":true}'
        );
        view.unmount();
    });

    it.each(['/dashboard/guild-1/structure', '/dashboard/guild-1/structure/'])(
        'treats the Blueprint index redirect at %s as the Overview pending island',
        (pathname) => {
            routerHarness.state = {
                isLoading: true,
                location: { pathname },
                resolvedLocation: { pathname: '/dashboard/guild-1/structure/backups' },
            };

            const view = render(<DashboardStructureRuntime guildId='guild-1' />);

            expect(screen.getByRole('heading', { level: 2, name: 'Blueprint overview' })).toBeTruthy();
            expect(screen.getByRole('status', { name: 'Loading server blueprint data' })).toBeTruthy();
            view.unmount();
        }
    );
});
