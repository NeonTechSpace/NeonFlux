// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardBlueprintWorkspaceShell } from './dashboard-blueprint-workspace-shell.js';

vi.mock('@tanstack/react-router', async () => {
    const { createElement } = await import('react');

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
        Outlet: () => null,
    };
});

describe('DashboardBlueprintWorkspaceShell', () => {
    it('keeps Blueprint identity around a local pending state', () => {
        const view = render(
            <DashboardBlueprintWorkspaceShell
                guildId='guild-1'
                runTransport={{ mode: 'idle' }}
                onNavigateSurface={async () => {}}>
                <p role='status'>Loading Blueprint data</p>
            </DashboardBlueprintWorkspaceShell>
        );

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        const heading = screen.getByRole('heading', { level: 1, name: 'Server Blueprint' });
        expect(heading).toBeTruthy();
        view.unmount();
    });

    it('acknowledges a tab request immediately with the target frame', () => {
        const onNavigateSurface = vi.fn(async () => {});
        const view = render(
            <DashboardBlueprintWorkspaceShell
                guildId='guild-1'
                runTransport={{ mode: 'idle' }}
                onNavigateSurface={onNavigateSurface}>
                <p>Previous tab content</p>
            </DashboardBlueprintWorkspaceShell>
        );

        fireEvent.click(screen.getByRole('link', { name: 'Backups' }));
        expect(onNavigateSurface).toHaveBeenCalledWith('backups');

        view.rerender(
            <DashboardBlueprintWorkspaceShell
                guildId='guild-1'
                runTransport={{ mode: 'idle' }}
                pendingSurface='backups'
                onNavigateSurface={onNavigateSurface}>
                <p>Previous tab content</p>
            </DashboardBlueprintWorkspaceShell>
        );

        expect(screen.getByRole('heading', { level: 2, name: 'Protected versions' })).toBeTruthy();
        expect(screen.queryByText('Previous tab content')).toBeNull();
        view.unmount();
    });

    it('keeps a failed leaf load inside Blueprint with a retry', () => {
        const onNavigateSurface = vi.fn(async () => {});
        const view = render(
            <DashboardBlueprintWorkspaceShell
                guildId='guild-1'
                runTransport={{ mode: 'idle' }}
                failedSurface='compare'
                onNavigateSurface={onNavigateSurface}>
                <p>Previous tab content</p>
            </DashboardBlueprintWorkspaceShell>
        );

        expect(screen.getByText('Diagnostic: BLUEPRINT_ROUTE_LOAD_FAILED')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry Blueprint' }));
        expect(onNavigateSurface).toHaveBeenCalledWith('compare');
        view.unmount();
    });
});
