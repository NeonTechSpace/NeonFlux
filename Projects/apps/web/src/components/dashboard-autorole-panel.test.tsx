// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deleteDashboardAutoroleRuleRouteData,
    readDashboardAutoroleSettingsRouteData,
    updateDashboardAutoroleRuleRouteData,
} from '../server/dashboard-autorole-route-data.js';
import type * as DashboardAutoroleRouteDataModule from '../server/dashboard-autorole-route-data.js';
import { DashboardAutorolePanel } from './dashboard-autorole-panel.js';

vi.mock('../server/dashboard-autorole-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardAutoroleRouteDataModule>();

    return {
        ...actual,
        deleteDashboardAutoroleRuleRouteData: vi.fn(),
        readDashboardAutoroleSettingsRouteData: vi.fn(),
        updateDashboardAutoroleRuleRouteData: vi.fn(),
    };
});

const renderedPanels: RenderResult[] = [];

describe('DashboardAutorolePanel', () => {
    afterEach(() => {
        for (const renderedPanel of renderedPanels.splice(0)) {
            renderedPanel.unmount();
        }
        vi.clearAllMocks();
    });

    it('saves a selected role through the TanStack Form autorole editor', async () => {
        vi.mocked(readDashboardAutoroleSettingsRouteData).mockResolvedValue(
            createAutoroleSettingsResult({ rules: [] })
        );
        vi.mocked(updateDashboardAutoroleRuleRouteData).mockResolvedValue({
            type: 'updated',
            rule: createAutoroleRule(),
        });

        renderAutorolePanel();

        fireEvent.change(await screen.findByPlaceholderText('Search roles'), { target: { value: 'member' } });
        fireEvent.click(await screen.findByRole('button', { name: /@Member/u }));
        fireEvent.click(screen.getByRole('button', { name: 'Save autorole' }));

        await waitFor(() => expect(updateDashboardAutoroleRuleRouteData).toHaveBeenCalled());
        expect(updateDashboardAutoroleRuleRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                roleId: 'role-1',
                name: 'Member',
                enabled: true,
            },
        });
        expect(await screen.findByText('Autorole saved.')).toBeTruthy();
    });

    it('rolls back optimistic save state when the server rejects the mutation', async () => {
        vi.mocked(readDashboardAutoroleSettingsRouteData).mockResolvedValue(
            createAutoroleSettingsResult({ rules: [] })
        );
        vi.mocked(updateDashboardAutoroleRuleRouteData).mockResolvedValue({
            type: 'database-error',
        });

        renderAutorolePanel();

        fireEvent.change(await screen.findByPlaceholderText('Search roles'), { target: { value: 'member' } });
        fireEvent.click(await screen.findByRole('button', { name: /@Member/u }));
        fireEvent.click(screen.getByRole('button', { name: 'Save autorole' }));

        expect(await screen.findByText('Could not save autorole settings.')).toBeTruthy();
        expect(screen.queryByText('Autorole saved.')).toBeNull();
    });

    it('removes an existing autorole rule with optimistic cache feedback', async () => {
        vi.mocked(readDashboardAutoroleSettingsRouteData).mockResolvedValue(createAutoroleSettingsResult());
        vi.mocked(deleteDashboardAutoroleRuleRouteData).mockResolvedValue({
            type: 'deleted',
            rule: createAutoroleRule(),
        });

        renderAutorolePanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(deleteDashboardAutoroleRuleRouteData).toHaveBeenCalled());
        expect(deleteDashboardAutoroleRuleRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                roleId: 'role-1',
            },
        });
        expect(await screen.findByText('Autorole removed.')).toBeTruthy();
    });
});

function renderAutorolePanel(): void {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
    const view = render(
        <QueryClientProvider client={queryClient}>
            <DashboardAutorolePanel guildId='guild-1' />
        </QueryClientProvider>
    );

    renderedPanels.push(view);
}

function createAutoroleSettingsResult(overrides: { rules?: ReturnType<typeof createAutoroleRule>[] } = {}) {
    return {
        type: 'settings' as const,
        roles: [
            {
                id: 'role-1',
                name: 'Member',
                position: 10,
            },
        ],
        roleReadStatus: 'available' as const,
        rules: overrides.rules ?? [createAutoroleRule()],
    };
}

function createAutoroleRule() {
    return {
        id: 'autorole-rule-1',
        roleId: 'role-1',
        name: 'Member',
        enabled: true,
        updatedAt: '2026-06-26T10:00:00.000Z',
    };
}
