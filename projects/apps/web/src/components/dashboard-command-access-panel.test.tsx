// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deleteDashboardCommandAccessRouteData,
    readDashboardCommandAccessRouteData,
    updateDashboardCommandAccessRouteData,
} from '../server/dashboard-guild-route-data.js';
import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';
import { DashboardCommandAccessPanel } from './dashboard-command-access-panel.js';

vi.mock('../server/dashboard-guild-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardGuildRouteDataModule>();

    return {
        ...actual,
        deleteDashboardCommandAccessRouteData: vi.fn(),
        readDashboardCommandAccessRouteData: vi.fn(),
        updateDashboardCommandAccessRouteData: vi.fn(),
    };
});

const renderedPanels: RenderResult[] = [];

describe('DashboardCommandAccessPanel', () => {
    afterEach(() => {
        for (const renderedPanel of renderedPanels.splice(0)) {
            renderedPanel.unmount();
        }
        vi.clearAllMocks();
    });

    it('saves role and user grants for a selected command', async () => {
        vi.mocked(readDashboardCommandAccessRouteData).mockResolvedValue(createAccessResult());
        vi.mocked(updateDashboardCommandAccessRouteData).mockResolvedValue({
            type: 'updated',
            rule: {
                targetType: 'command',
                targetId: 'moderation.ban',
                userIds: ['user-1'],
                roleIds: ['role-mod'],
                updatedAt: '2026-06-28T00:00:00.000Z',
            },
        });

        renderCommandAccessPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Command' }));
        fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'moderation.ban' } });
        fireEvent.change(screen.getByPlaceholderText('Search roles'), { target: { value: 'mod' } });
        fireEvent.click(await screen.findByRole('button', { name: /Moderator/u }));
        fireEvent.change(screen.getByLabelText('User IDs'), { target: { value: 'user-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save command grant' }));

        await waitFor(() => expect(updateDashboardCommandAccessRouteData).toHaveBeenCalled());
        expect(updateDashboardCommandAccessRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                targetType: 'command',
                targetId: 'moderation.ban',
                userIds: ['user-1'],
                roleIds: ['role-mod'],
            },
        });
        expect(await screen.findByText('Command access saved.')).toBeTruthy();
    });

    it('removes an existing command grant', async () => {
        vi.mocked(readDashboardCommandAccessRouteData).mockResolvedValue(createAccessResult());
        vi.mocked(deleteDashboardCommandAccessRouteData).mockResolvedValue({
            type: 'deleted',
            targetType: 'command',
            targetId: 'settings.prefix',
        });

        renderCommandAccessPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(deleteDashboardCommandAccessRouteData).toHaveBeenCalled());
        expect(deleteDashboardCommandAccessRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                targetType: 'command',
                targetId: 'settings.prefix',
            },
        });
        expect(await screen.findByText('Command access removed.')).toBeTruthy();
    });
});

function renderCommandAccessPanel(): void {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
    const view = render(
        <QueryClientProvider client={queryClient}>
            <DashboardCommandAccessPanel guildId='guild-1' />
        </QueryClientProvider>
    );

    renderedPanels.push(view);
}

function createAccessResult() {
    return {
        type: 'access' as const,
        catalog: {
            categories: [{ id: 'moderation', title: 'Moderation' }],
            commands: [
                {
                    id: 'settings.prefix',
                    categoryId: 'settings',
                    categoryTitle: 'Settings',
                    commandName: 'prefix',
                    description: 'Change the command prefix.',
                },
                {
                    id: 'moderation.ban',
                    categoryId: 'moderation',
                    categoryTitle: 'Moderation',
                    commandName: 'ban',
                    description: 'Ban a user and record a moderation case.',
                },
            ],
        },
        roles: [
            {
                id: 'role-mod',
                name: 'Moderator',
                position: 20,
            },
        ],
        roleReadStatus: 'available' as const,
        rules: [
            {
                targetType: 'command' as const,
                targetId: 'settings.prefix',
                userIds: [],
                roleIds: ['role-mod'],
                updatedAt: '2026-06-24T00:00:00.000Z',
            },
        ],
    };
}
