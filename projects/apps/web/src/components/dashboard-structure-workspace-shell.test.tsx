// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
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
    it('keeps Blueprint identity around a local pending state', () => {
        render(
            <DashboardStructureWorkspaceShell guildId='guild-1' executionTransport={{ mode: 'idle' }}>
                <p role='status'>Loading Blueprint data</p>
            </DashboardStructureWorkspaceShell>
        );

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        const heading = screen.getByRole('heading', { level: 1, name: 'Server Blueprint' });
        expect(heading).toBeTruthy();
        expect(screen.getByRole('status').textContent).toBe('Loading Blueprint data');
    });
});
