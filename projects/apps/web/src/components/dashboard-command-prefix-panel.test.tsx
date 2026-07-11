// @vitest-environment jsdom

import { DEFAULT_COMMAND_PREFIX } from '@neonflux/core/command-prefix';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDashboardCommandSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardCommandSettingsRouteData,
    updateDashboardCommandPrefixRouteData,
} from '../server/dashboard-guild-route-data.js';
import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';
import { DashboardCommandPrefixSettingsPanel } from './dashboard-command-prefix-panel.js';

vi.mock('../server/dashboard-guild-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardGuildRouteDataModule>();

    return {
        ...actual,
        readDashboardCommandSettingsRouteData: vi.fn(),
        updateDashboardCommandPrefixRouteData: vi.fn(),
    };
});

const renderedPanels: RenderResult[] = [];

describe('DashboardCommandPrefixSettingsPanel', () => {
    afterEach(() => {
        for (const renderedPanel of renderedPanels.splice(0)) {
            renderedPanel.unmount();
        }
        vi.clearAllMocks();
    });

    it('restores the confirmed prefix when an optimistic update fails', async () => {
        vi.mocked(updateDashboardCommandPrefixRouteData).mockRejectedValue(new Error('offline'));
        const { queryClient } = renderPrefixPanel();
        const input = screen.getByLabelText<HTMLInputElement>('New prefix');

        fireEvent.change(input, { target: { value: '$' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save prefix' }));

        expect(await screen.findByText('Could not update the command prefix. Try again.')).toBeTruthy();
        expect(queryClient.getQueryData(getDashboardCommandSettingsQueryKey('guild-1'))).toStrictEqual({
            prefix: DEFAULT_COMMAND_PREFIX,
            isDefaultPrefix: true,
        });
        expect(input.value).toBe('$');
    });

    it('keeps a dirty draft visible when the prefix changes elsewhere and can adopt the confirmed value', async () => {
        const { queryClient } = renderPrefixPanel();
        const input = screen.getByLabelText<HTMLInputElement>('New prefix');

        fireEvent.change(input, { target: { value: '$' } });
        act(() => {
            queryClient.setQueryData(getDashboardCommandSettingsQueryKey('guild-1'), {
                prefix: '?',
                isDefaultPrefix: false,
            });
        });

        expect(await screen.findByText('Command prefix changed elsewhere to ?.')).toBeTruthy();
        expect(input.value).toBe('$');

        fireEvent.click(screen.getByRole('button', { name: 'Use current prefix' }));

        expect(input.value).toBe('?');
        expect(screen.queryByText('Command prefix changed elsewhere to ?.')).toBeNull();
    });
});

function renderPrefixPanel(): { queryClient: QueryClient } {
    vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValue({
        type: 'settings',
        commandSettings: {
            prefix: DEFAULT_COMMAND_PREFIX,
            isDefaultPrefix: true,
        },
    });
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    renderedPanels.push(
        render(
            <QueryClientProvider client={queryClient}>
                <DashboardCommandPrefixSettingsPanel
                    guildId='guild-1'
                    commandSettings={{ prefix: DEFAULT_COMMAND_PREFIX, isDefaultPrefix: true }}
                />
            </QueryClientProvider>
        )
    );

    return { queryClient };
}
