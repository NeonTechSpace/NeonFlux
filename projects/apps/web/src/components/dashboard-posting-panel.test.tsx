// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OUTGOING_MESSAGE_LIMITS } from '@neonflux/messaging';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';

import {
    postDashboardMessageRouteData,
    readDashboardPostingCatalogRouteData,
    readDashboardPostingOperationsRouteData,
    resolveDashboardPostingUnknownRouteData,
} from '../server/dashboard-guild-route-data.js';
import { readDashboardPostingTemplatesRouteData } from '../server/dashboard-posting-templates-route-data.js';
import { DashboardPostingPanel } from './dashboard-posting-panel.js';

let unmountPanel: (() => void) | undefined;

vi.mock('../server/dashboard-guild-route-data.js', async (importOriginal) => ({
    ...(await importOriginal<typeof DashboardGuildRouteDataModule>()),
    postDashboardMessageRouteData: vi.fn(),
    readDashboardPostingCatalogRouteData: vi.fn(),
    readDashboardPostingOperationsRouteData: vi.fn(),
    resolveDashboardPostingUnknownRouteData: vi.fn(),
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
        vi.mocked(readDashboardPostingCatalogRouteData).mockResolvedValue({
            catalog: {
                channels: [{ id: 'channel-1', name: 'general', type: 0 }],
                emojis: [],
                roles: [],
            },
            type: 'catalog',
        });
        vi.mocked(readDashboardPostingOperationsRouteData).mockResolvedValue({ operations: [], type: 'operations' });
        vi.mocked(readDashboardPostingTemplatesRouteData).mockResolvedValue({ templates: [], type: 'templates' });
        vi.mocked(postDashboardMessageRouteData).mockResolvedValue({
            operation: createOperation('queued'),
            type: 'operation',
        });
        vi.mocked(resolveDashboardPostingUnknownRouteData).mockResolvedValue({
            operation: createOperation('unknown', 'reported_seen'),
            type: 'resolved',
        });
    });

    it('links an explicit duplicate-risk follow-up to an unknown delivery', async () => {
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
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

        await waitFor(() => expect(postDashboardMessageRouteData).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(/delivery could not be confirmed/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Send a new copy despite duplicate risk' }));

        await waitFor(() => expect(postDashboardMessageRouteData).toHaveBeenCalledTimes(2));
        const followupCall = vi.mocked(postDashboardMessageRouteData).mock.calls[1]?.[0];
        if (!followupCall) throw new Error('Expected duplicate-risk follow-up call.');
        expect(followupCall.data).toMatchObject({
            retryOfOperationId: 'operation-1',
        });
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
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

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

        expect(await screen.findByRole('button', { name: 'I found the message' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'I did not find it' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Send a new copy despite duplicate risk' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByText(/mentions are suppressed/i)).toBeTruthy();
    });

    it('keeps an older unresolved delivery actionable when a newer terminal delivery exists', async () => {
        vi.mocked(readDashboardPostingOperationsRouteData).mockResolvedValue({
            operations: [{ ...createOperation('sent'), id: 'operation-2' }, createOperation('unknown')],
            type: 'operations',
        });

        renderPanel();

        expect(await screen.findByRole('button', { name: 'I found the message' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);
    });

    it('durably records the operator observation for an unknown delivery', async () => {
        vi.mocked(readDashboardPostingOperationsRouteData)
            .mockResolvedValueOnce({ operations: [createOperation('unknown')], type: 'operations' })
            .mockResolvedValue({
                operations: [createOperation('unknown', 'reported_seen')],
                type: 'operations',
            });
        renderPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'I found the message' }));

        await waitFor(() =>
            expect(resolveDashboardPostingUnknownRouteData).toHaveBeenCalledWith({
                data: { guildId: 'guild-1', operationId: 'operation-1', resolution: 'reported_seen' },
            })
        );
        expect(await screen.findByText('Recorded that you found the message.')).toBeTruthy();
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

    it('keeps optional embed controls collapsed until requested and validates URLs inline', () => {
        renderPanel();

        expect(screen.queryByRole('region', { name: 'Embed builder' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Add embed' }));

        const title = screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' });
        const body = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Main body' });
        expect(title.maxLength).toBe(OUTGOING_MESSAGE_LIMITS.embedTitle);
        expect(body.maxLength).toBe(OUTGOING_MESSAGE_LIMITS.embedDescription);

        fireEvent.change(title, { target: { value: 'Release notes' } });
        const titleUrl = screen.getByRole<HTMLInputElement>('textbox', { name: 'Title URL' });
        fireEvent.change(titleUrl, { target: { value: 'not-a-url' } });

        expect(screen.getAllByText(/complete http:\/\/ or https:\/\/ URL/i).length).toBeGreaterThan(0);
        expect(titleUrl.getAttribute('aria-invalid')).toBe('true');
    });

    it('enables template saving only after the name and payload are ready', () => {
        renderPanel();

        const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save current' });
        expect(save.disabled).toBe(true);

        fireEvent.change(screen.getByRole('textbox', { name: 'Message content' }), {
            target: { value: 'Release notes' },
        });
        expect(save.disabled).toBe(true);

        fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
            target: { value: 'Release update' },
        });
        expect(save.disabled).toBe(false);
    });

    it('keeps failed posting reads visible while their explicit retries are in flight', async () => {
        vi.mocked(readDashboardPostingCatalogRouteData)
            .mockResolvedValueOnce({ type: 'database-error' })
            .mockImplementationOnce(() => new Promise(() => undefined));
        vi.mocked(readDashboardPostingOperationsRouteData)
            .mockResolvedValueOnce({ type: 'database-error' })
            .mockImplementationOnce(() => new Promise(() => undefined));
        vi.mocked(readDashboardPostingTemplatesRouteData)
            .mockResolvedValueOnce({ type: 'database-error' })
            .mockImplementationOnce(() => new Promise(() => undefined));

        renderPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Retry channels' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Retry delivery status' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Retry templates' }));

        await waitFor(() => {
            const retryingButtons = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Retrying…' });
            expect(retryingButtons).toHaveLength(3);
            expect(retryingButtons.every((button) => button.disabled)).toBe(true);
        });
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

function createOperation(
    status: 'queued' | 'running' | 'unknown' | 'sent' | 'permanent_failure',
    resolution?: 'duplicate_risk_accepted' | 'reported_not_seen' | 'reported_seen'
) {
    return {
        attemptCount: status === 'queued' ? 0 : 1,
        contentLength: 19,
        createdAt: '2026-07-13T12:00:00.000Z',
        embedCount: 0,
        id: 'operation-1',
        requestKey: 'request-1',
        requestedChannelId: 'channel-1',
        ...(resolution ? { resolution } : {}),
        status,
        updatedAt: '2026-07-13T12:00:01.000Z',
    };
}
