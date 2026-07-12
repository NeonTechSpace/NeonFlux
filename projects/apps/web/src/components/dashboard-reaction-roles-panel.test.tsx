// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    deleteDashboardReactionRoleMessageRouteData,
    readDashboardReactionRolesSettingsRouteData,
    retryDashboardReactionRoleMembersRouteData,
    retryDashboardReactionRoleOperationRouteData,
} from '../server/dashboard-reaction-roles-route-data.js';
import { DashboardReactionRolesPanel } from './dashboard-reaction-roles-panel.js';

let unmountPanel: (() => void) | undefined;

vi.mock('../server/dashboard-reaction-roles-route-data.js', () => ({
    deleteDashboardReactionRoleMessageRouteData: vi.fn(),
    publishDashboardReactionRoleMessageRouteData: vi.fn(),
    readDashboardReactionRolesSettingsRouteData: vi.fn(),
    retryDashboardReactionRoleOperationRouteData: vi.fn(),
    retryDashboardReactionRoleMembersRouteData: vi.fn(),
    saveDashboardReactionRoleMessageRouteData: vi.fn(),
}));

describe('reaction-role operation status', () => {
    afterEach(() => unmountPanel?.());

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(readDashboardReactionRolesSettingsRouteData).mockResolvedValue({
            channels: [],
            emojiReadStatus: 'available',
            emojis: [],
            messages: [],
            operations: [
                {
                    blockedCount: 1,
                    channelId: 'channel-1',
                    errorCode: 'unknown_publish_outcome',
                    id: 'operation-1',
                    processedCount: 0,
                    status: 'needs_attention',
                    totalCount: 0,
                    type: 'publish',
                    updatedAt: '2026-07-10T08:00:00.000Z',
                },
            ],
            roles: [],
            structureReadStatus: 'available',
            type: 'settings',
        });
        vi.mocked(retryDashboardReactionRoleOperationRouteData).mockResolvedValue({
            operation: {
                blockedCount: 0,
                channelId: 'channel-1',
                id: 'operation-1',
                processedCount: 0,
                status: 'queued',
                totalCount: 0,
                type: 'publish',
                updatedAt: '2026-07-10T08:01:00.000Z',
            },
            type: 'operation-accepted',
        });
    });

    it('requires explicit orphan confirmation before retrying an uncertain publish', async () => {
        renderPanel();

        expect((await screen.findByText('Needs administrator attention')).textContent).toContain('Needs');
        expect(screen.getByText(/will not retry automatically/i).textContent).toContain('will not retry');
        fireEvent.click(screen.getByRole('button', { name: /verify channel, then retry/i }));

        expect(retryDashboardReactionRoleOperationRouteData).not.toHaveBeenCalled();
        expect(screen.getByText(/select the retry action again/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /confirm channel is clear/i }));

        await waitFor(() =>
            expect(retryDashboardReactionRoleOperationRouteData).toHaveBeenCalledWith({
                data: {
                    confirmUnknownPublishAbsent: true,
                    guildId: 'guild-1',
                    operationId: 'operation-1',
                },
            })
        );
    });

    it('offers one empty-state action and one editor heading', async () => {
        vi.mocked(readDashboardReactionRolesSettingsRouteData).mockResolvedValue({
            channels: [],
            emojiReadStatus: 'available',
            emojis: [],
            messages: [],
            operations: [],
            roles: [],
            structureReadStatus: 'available',
            type: 'settings',
        });
        renderPanel();

        expect(await screen.findByText('Your first role menu')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Create menu' })).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Create menu' }));

        expect(screen.getAllByText('Create reaction-role menu')).toHaveLength(1);
        expect(screen.queryByText('Reaction-role menus')).toBeNull();
        expect(screen.getByText('Members cannot use this menu until Fluxer confirms synchronization.')).toBeTruthy();
    });

    it('exposes retry for terminal member-assignment failures', async () => {
        vi.mocked(readDashboardReactionRolesSettingsRouteData).mockResolvedValue({
            channels: [],
            emojiReadStatus: 'available',
            emojis: [],
            messages: [
                {
                    id: 'menu-1',
                    channelId: 'channel-1',
                    messageId: 'message-1',
                    mode: 'normal',
                    source: 'dashboard',
                    messageContent: 'Choose',
                    messageEmbeds: [],
                    generateOverview: false,
                    enabled: true,
                    lifecycle: 'needs_attention',
                    revision: 1,
                    updatedAt: '2026-07-10T08:00:00.000Z',
                    options: [],
                },
            ],
            operations: [],
            roles: [],
            structureReadStatus: 'available',
            type: 'settings',
        });
        vi.mocked(retryDashboardReactionRoleMembersRouteData).mockResolvedValue({
            type: 'member-retry-queued',
            hasMore: false,
            retriedCount: 1,
        });
        renderPanel();

        fireEvent.click(await screen.findByRole('button', { name: /retry blocked assignments/i }));

        await waitFor(() =>
            expect(retryDashboardReactionRoleMembersRouteData).toHaveBeenCalledWith({
                data: { guildId: 'guild-1', messageId: 'message-1' },
            })
        );
    });

    it('reenables delete after a rejected cleanup request', async () => {
        vi.mocked(readDashboardReactionRolesSettingsRouteData).mockResolvedValue({
            channels: [],
            emojiReadStatus: 'available',
            emojis: [],
            messages: [
                {
                    id: 'menu-1',
                    channelId: 'channel-1',
                    messageId: 'message-1',
                    mode: 'normal',
                    source: 'dashboard',
                    messageContent: 'Choose',
                    messageEmbeds: [],
                    generateOverview: false,
                    enabled: true,
                    lifecycle: 'ready',
                    revision: 1,
                    updatedAt: '2026-07-10T08:00:00.000Z',
                    options: [],
                },
            ],
            operations: [],
            roles: [],
            structureReadStatus: 'available',
            type: 'settings',
        });
        vi.mocked(deleteDashboardReactionRoleMessageRouteData).mockRejectedValue(new Error('offline'));
        renderPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

        expect(await screen.findByText('Could not delete that reaction-role menu.')).toBeTruthy();
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(false)
        );
    });
});

function renderPanel() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
        <QueryClientProvider client={queryClient}>
            <DashboardReactionRolesPanel guildId='guild-1' />
        </QueryClientProvider>
    );
    unmountPanel = view.unmount;
    return view;
}
