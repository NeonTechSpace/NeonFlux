// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readDashboardReactionRolesRouteData } from '../server/dashboard-reaction-roles-route-data.js';
import type * as ReactionRoleRouteData from '../server/dashboard-reaction-roles-route-data.js';
import { DashboardReactionRolesPanel } from './dashboard-reaction-roles-panel.js';

vi.mock('../server/dashboard-reaction-roles-route-data.js', async (importActual) => ({
    ...(await importActual<typeof ReactionRoleRouteData>()),
    deactivateDashboardReactionRoleRouteData: vi.fn(),
    publishDashboardReactionRoleRouteData: vi.fn(),
    readDashboardReactionRolesRouteData: vi.fn(),
    updateDashboardReactionRoleRouteData: vi.fn(),
}));

let unmountPanel: (() => void) | undefined;

describe('DashboardReactionRolesPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(readDashboardReactionRolesRouteData).mockResolvedValue({
            catalog: {
                channels: [
                    {
                        eligible: true,
                        id: 'channel-1',
                        name: 'roles',
                        parentId: null,
                        parentName: null,
                        position: 1,
                    },
                ],
                emojis: [],
                guildId: 'guild-1',
                guildName: 'Guild',
                roles: [
                    { color: 0, eligible: true, id: 'role-1', name: 'Alpha' },
                    { color: 0, eligible: true, id: 'role-2', name: 'Beta' },
                ],
            },
            panels: [],
            type: 'reaction-roles',
        });
    });

    afterEach(() => {
        unmountPanel?.();
        unmountPanel = undefined;
    });

    it('chooses unique defaults and blocks publication when emoji become duplicated', async () => {
        renderPanel();
        await screen.findByText('No panels yet');
        fireEvent.change(screen.getByLabelText('Panel name'), { target: { value: 'Community roles' } });
        fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'channel-1' } });
        fireEvent.change(screen.getByPlaceholderText(/Write an introduction/), { target: { value: '{roles}' } });

        fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add role' }));

        const emojiInputs = screen.getAllByLabelText<HTMLInputElement>('Unicode emoji');
        expect(emojiInputs).toHaveLength(2);
        expect(emojiInputs[0]?.value).not.toBe(emojiInputs[1]?.value);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish panel' }).disabled).toBe(false);

        fireEvent.change(emojiInputs[1], { target: { value: emojiInputs[0]?.value } });

        await waitFor(() =>
            expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish panel' }).disabled).toBe(true)
        );
        expect(screen.getByText(/Fix options/)).toBeTruthy();
    });
});

function renderPanel(): void {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false },
        },
    });
    const view = render(
        <QueryClientProvider client={queryClient}>
            <DashboardReactionRolesPanel guildId='guild-1' />
        </QueryClientProvider>
    );
    unmountPanel = view.unmount;
}
