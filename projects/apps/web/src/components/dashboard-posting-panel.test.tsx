// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';

import {
    postDashboardMessageRouteData,
    readDashboardPostingChannelsRouteData,
    readDashboardPostingOperationsRouteData,
} from '../server/dashboard-guild-route-data.js';
import { readDashboardPostingTemplatesRouteData } from '../server/dashboard-posting-templates-route-data.js';
import { DashboardPostingPanel } from './dashboard-posting-panel.js';

let unmountPanel: (() => void) | undefined;

vi.mock('../server/dashboard-guild-route-data.js', async (importOriginal) => ({
    ...(await importOriginal<typeof DashboardGuildRouteDataModule>()),
    postDashboardMessageRouteData: vi.fn(),
    readDashboardPostingChannelsRouteData: vi.fn(),
    readDashboardPostingOperationsRouteData: vi.fn(),
}));

vi.mock('../server/dashboard-posting-templates-route-data.js', () => ({
    deleteDashboardPostingTemplateRouteData: vi.fn(),
    readDashboardPostingTemplatesRouteData: vi.fn(),
    saveDashboardPostingTemplateRouteData: vi.fn(),
}));

describe('DashboardPostingPanel', () => {
    afterEach(() => unmountPanel?.());

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(readDashboardPostingChannelsRouteData).mockResolvedValue({
            channels: [{ id: 'channel-1', name: 'general', type: 0 }],
            type: 'channels',
        });
        vi.mocked(readDashboardPostingOperationsRouteData).mockResolvedValue({ operations: [], type: 'operations' });
        vi.mocked(readDashboardPostingTemplatesRouteData).mockResolvedValue({ templates: [], type: 'templates' });
        vi.mocked(postDashboardMessageRouteData).mockResolvedValue({
            operation: createOperation('queued'),
            type: 'operation',
        });
    });

    it('updates a queued attempt to unknown and requires explicit duplicate-risk acknowledgement', async () => {
        renderPanel();

        const channelPicker = await screen.findByRole('combobox', { name: 'Channel' });
        await waitFor(() => expect(readDashboardPostingOperationsRouteData).toHaveBeenCalled());
        vi.mocked(readDashboardPostingOperationsRouteData).mockResolvedValue({
            operations: [createOperation('unknown')],
            type: 'operations',
        });
        fireEvent.focus(channelPicker);
        fireEvent.click(await screen.findByRole('option', { name: /#general/i }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Message content' }), {
            target: { value: 'Hello from NeonFlux' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Queue message' }));

        await waitFor(() => expect(postDashboardMessageRouteData).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(/delivery could not be confirmed/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Queue message' }).hasAttribute('disabled')).toBe(true);

        fireEvent.click(
            screen.getByRole('checkbox', { name: /accept that another attempt could still create a duplicate/i })
        );

        expect(screen.getByRole('button', { name: 'Queue message' }).hasAttribute('disabled')).toBe(false);
        expect(postDashboardMessageRouteData).toHaveBeenCalledTimes(1);
    });

    it('updates the primary confirmation when a queued attempt becomes sent', async () => {
        renderPanel();

        const channelPicker = await screen.findByRole('combobox', { name: 'Channel' });
        await waitFor(() => expect(readDashboardPostingOperationsRouteData).toHaveBeenCalled());
        vi.mocked(readDashboardPostingOperationsRouteData).mockResolvedValue({
            operations: [createOperation('sent')],
            type: 'operations',
        });
        fireEvent.focus(channelPicker);
        fireEvent.click(await screen.findByRole('option', { name: /#general/i }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Message content' }), {
            target: { value: 'Hello from NeonFlux' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Queue message' }));

        expect(await screen.findByText('Sent to #general.')).toBeTruthy();
        expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message content' }).value).toBe(
            'Hello from NeonFlux'
        );
    });

    it('shows recent terminal delivery after a page refresh', async () => {
        vi.mocked(readDashboardPostingOperationsRouteData).mockResolvedValue({
            operations: [createOperation('sent')],
            type: 'operations',
        });

        renderPanel();

        expect(await screen.findByRole('heading', { name: 'Recent delivery' })).toBeTruthy();
        expect(screen.getByText('Delivery was confirmed.')).toBeTruthy();
    });

    it('keeps an unknown latest delivery gated after a page refresh', async () => {
        vi.mocked(readDashboardPostingOperationsRouteData).mockResolvedValue({
            operations: [createOperation('unknown')],
            type: 'operations',
        });

        renderPanel();

        expect(
            await screen.findByRole('checkbox', { name: /accept that another attempt could still create a duplicate/i })
        ).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Queue message' }).hasAttribute('disabled')).toBe(true);
    });

    it('confirms before a template replaces an in-progress message', async () => {
        vi.mocked(readDashboardPostingTemplatesRouteData).mockResolvedValue({
            templates: [
                {
                    id: 'template-1',
                    guildId: 'guild-1',
                    name: 'Release update',
                    content: 'Template content',
                    embeds: [],
                    updatedAt: '2026-07-12T12:00:00.000Z',
                },
            ],
            type: 'templates',
        });
        renderPanel();

        const message = screen.getByRole('textbox', { name: 'Message content' });
        fireEvent.change(message, { target: { value: 'Unsaved message' } });
        const templates = await screen.findByRole('combobox', { name: 'Saved templates' });
        await screen.findByRole('option', { name: 'Release update' });
        fireEvent.change(templates, { target: { value: 'template-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        expect(screen.getByText(/replace the current message/i)).toBeTruthy();
        expect((message as HTMLTextAreaElement).value).toBe('Unsaved message');

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(screen.queryByRole('button', { name: 'Confirm replace' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm replace' }));

        expect((message as HTMLTextAreaElement).value).toBe('Template content');
    });
});

function renderPanel() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const view = render(
        <QueryClientProvider client={queryClient}>
            <DashboardPostingPanel guildId='guild-1' />
        </QueryClientProvider>
    );
    unmountPanel = view.unmount;
    return view;
}

function createOperation(status: 'queued' | 'running' | 'unknown' | 'sent' | 'permanent_failure') {
    return {
        attemptCount: status === 'queued' ? 0 : 1,
        contentLength: 19,
        createdAt: '2026-07-13T12:00:00.000Z',
        embedCount: 0,
        id: 'operation-1',
        requestKey: 'request-1',
        requestedChannelId: 'channel-1',
        status,
        updatedAt: '2026-07-13T12:00:01.000Z',
    };
}
