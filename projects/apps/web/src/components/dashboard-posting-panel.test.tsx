// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';

import {
    postDashboardMessageRouteData,
    readDashboardPostingChannelsRouteData,
} from '../server/dashboard-guild-route-data.js';
import { readDashboardPostingTemplatesRouteData } from '../server/dashboard-posting-templates-route-data.js';
import { DashboardPostingPanel } from './dashboard-posting-panel.js';

let unmountPanel: (() => void) | undefined;

vi.mock('../server/dashboard-guild-route-data.js', async (importOriginal) => ({
    ...(await importOriginal<typeof DashboardGuildRouteDataModule>()),
    postDashboardMessageRouteData: vi.fn(),
    readDashboardPostingChannelsRouteData: vi.fn(),
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
        vi.mocked(readDashboardPostingTemplatesRouteData).mockResolvedValue({ templates: [], type: 'templates' });
        vi.mocked(postDashboardMessageRouteData).mockResolvedValue({ type: 'delivery-unknown' });
    });

    it('requires an explicit new attempt after delivery becomes unknown', async () => {
        renderPanel();

        const channelPicker = await screen.findByRole('combobox', { name: 'Channel' });
        fireEvent.focus(channelPicker);
        fireEvent.click(await screen.findByRole('option', { name: /#general/i }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Message content' }), {
            target: { value: 'Hello from NeonFlux' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

        await waitFor(() => expect(postDashboardMessageRouteData).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(/delivery could not be confirmed/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Start new attempt' }));

        expect(screen.getByText('A new posting attempt is ready.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false);
        expect(postDashboardMessageRouteData).toHaveBeenCalledTimes(1);
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
