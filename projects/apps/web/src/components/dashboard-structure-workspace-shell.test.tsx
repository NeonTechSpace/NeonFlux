// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardStructureWorkspaceShell } from './dashboard-structure-workspace-shell.js';

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

describe('DashboardStructureWorkspaceShell', () => {
    it('keeps Blueprint identity and route navigation around a local pending state', () => {
        render(
            <DashboardStructureWorkspaceShell guildId='guild-1' executionTransport={{ mode: 'idle' }}>
                <p role='status'>Loading Blueprint data</p>
            </DashboardStructureWorkspaceShell>
        );

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1, name: 'Server Blueprint' })).toBeTruthy();

        const navigation = screen.getByRole('navigation', { name: 'Server Blueprint tools' });
        expect(within(navigation).getAllByRole('link')).toHaveLength(5);
        expect(within(navigation).getByRole('link', { name: 'Backups' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/structure/backups'
        );
        expect(screen.getByRole('status').textContent).toBe('Loading Blueprint data');
    });
});
