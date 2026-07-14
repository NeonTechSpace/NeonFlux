// @vitest-environment jsdom

import { DEFAULT_COMMAND_PREFIX } from '@neonflux/core/command-prefix';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDashboardCommandSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    readDashboardCommandSettingsRouteData,
    updateDashboardCommandPrefixRouteData,
} from '../server/dashboard-guild-route-data.js';
import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';
import { DashboardCommandPrefixSettingsPanel } from './dashboard-command-prefix-panel.js';
import { DashboardCommandPrefixRouteContent } from './dashboard-command-prefix-route-content.js';

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

describe('DashboardCommandPrefixRouteContent', () => {
    afterEach(() => {
        for (const renderedPanel of renderedPanels.splice(0)) renderedPanel.unmount();
        vi.clearAllMocks();
    });

    it('keeps the form structure available while the authoritative prefix is loading', async () => {
        const settingsRequest = createDeferred<{
            type: 'settings';
            commandSettings: { prefix: string; isDefaultPrefix: boolean };
        }>();
        vi.mocked(readDashboardCommandSettingsRouteData).mockReturnValue(settingsRequest.promise);
        renderRouteContent();

        expect(screen.getByLabelText<HTMLInputElement>('New prefix').disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save prefix' }).disabled).toBe(true);

        settingsRequest.resolve({
            type: 'settings',
            commandSettings: { prefix: DEFAULT_COMMAND_PREFIX, isDefaultPrefix: true },
        });
        await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('New prefix').disabled).toBe(false));
    });

    it('shows a busy retry and prevents duplicate settings reads', async () => {
        const retryRequest = createDeferred<{ type: 'database-error' }>();
        vi.mocked(readDashboardCommandSettingsRouteData)
            .mockResolvedValueOnce({ type: 'database-error' })
            .mockReturnValueOnce(retryRequest.promise);
        renderRouteContent();

        fireEvent.click(await screen.findByRole('button', { name: 'Retry settings' }));
        const retryButton = await screen.findByRole<HTMLButtonElement>('button', { name: 'Retrying…' });
        expect(retryButton.disabled).toBe(true);
        fireEvent.click(retryButton);
        expect(readDashboardCommandSettingsRouteData).toHaveBeenCalledTimes(2);

        retryRequest.resolve({ type: 'database-error' });
        expect(await screen.findByRole('button', { name: 'Retry settings' })).toBeTruthy();
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

function renderRouteContent(): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderedPanels.push(
        render(
            <QueryClientProvider client={queryClient}>
                <DashboardCommandPrefixRouteContent guildId='guild-1' />
            </QueryClientProvider>
        )
    );
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}
