// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    readDashboardReactionRolesSettingsRouteData,
    retryDashboardReactionRoleMembersRouteData,
    retryDashboardReactionRoleOperationRouteData,
} from '../server/dashboard-reaction-roles-route-data.js';
import { DashboardReactionRolesPanel } from './dashboard-reaction-roles-panel.js';

vi.mock('../server/dashboard-reaction-roles-route-data.js', () => ({
    deleteDashboardReactionRoleMessageRouteData: vi.fn(),
    publishDashboardReactionRoleMessageRouteData: vi.fn(),
    readDashboardReactionRolesSettingsRouteData: vi.fn(),
    retryDashboardReactionRoleOperationRouteData: vi.fn(),
    retryDashboardReactionRoleMembersRouteData: vi.fn(),
    saveDashboardReactionRoleMessageRouteData: vi.fn(),
}));

describe('reaction-role operation status', () => {
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
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        renderPanel();

        expect((await screen.findByText('Needs administrator attention')).textContent).toContain('Needs');
        expect(screen.getByText(/will not retry automatically/i).textContent).toContain('will not retry');
        fireEvent.click(screen.getByRole('button', { name: /removed any orphan/i }));

        expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Confirm that you checked'));
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
});

function renderPanel() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <DashboardReactionRolesPanel guildId='guild-1' />
        </QueryClientProvider>
    );
}
