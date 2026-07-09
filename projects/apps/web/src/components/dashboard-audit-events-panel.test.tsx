// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    readDashboardAuditEventsRouteData,
    readDashboardPostingChannelsRouteData,
} from '../server/dashboard-guild-route-data.js';
import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';
import { DashboardAuditEventsPanel } from './dashboard-audit-events-panel.js';

vi.mock('../server/dashboard-guild-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardGuildRouteDataModule>();

    return {
        ...actual,
        readDashboardAuditEventsRouteData: vi.fn(),
        readDashboardPostingChannelsRouteData: vi.fn(),
    };
});

const renderedPanels: RenderResult[] = [];

describe('DashboardAuditEventsPanel', () => {
    afterEach(() => {
        for (const renderedPanel of renderedPanels.splice(0)) {
            renderedPanel.unmount();
        }
        vi.clearAllMocks();
    });

    it('renders Server Blueprint import-run targets and metadata without message labels', async () => {
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValue({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'import_export',
                    action: 'structure.import_applied',
                    actorUserId: 'user-1',
                    actorUsername: 'operator',
                    targetId: 'run-1',
                    createdAt: '2026-07-09T10:00:00.000Z',
                    metadata: {
                        actionCount: 4,
                        appliedCount: 3,
                        failedCount: 1,
                        restorePointBackupId: 'backup-restore-1',
                    },
                },
            ],
        });
        vi.mocked(readDashboardPostingChannelsRouteData).mockResolvedValue({
            type: 'channels',
            channels: [],
        });

        renderAuditPanel();

        expect(await screen.findByText('structure.import_applied')).toBeTruthy();
        expect(screen.getByText('Import run')).toBeTruthy();
        expect(screen.getByText('run-1')).toBeTruthy();
        expect(screen.getByText('Actions')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
        expect(screen.getByText('Applied')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(screen.getByText('Failed')).toBeTruthy();
        expect(screen.getByText('1')).toBeTruthy();
        expect(screen.getByText('Restore point')).toBeTruthy();
        expect(screen.getByText('backup-restore-1')).toBeTruthy();
        expect(within(screen.getByRole('list', { name: 'Dashboard audit events' })).queryByText('Message')).toBeNull();
    });

    it('renders backup and retention targets with feature-aware labels', async () => {
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValue({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'import_export',
                    action: 'structure.backup_renamed',
                    targetId: 'backup-1',
                    createdAt: '2026-07-09T10:00:00.000Z',
                    metadata: { name: 'Before risky apply' },
                },
                {
                    id: 'event-2',
                    feature: 'import_export',
                    action: 'structure.backup_retention_pruned',
                    targetId: 'guild-1',
                    createdAt: '2026-07-09T09:00:00.000Z',
                    metadata: { deletedCount: 2, source: 'scheduled_retention' },
                },
            ],
        });
        vi.mocked(readDashboardPostingChannelsRouteData).mockResolvedValue({
            type: 'channels',
            channels: [],
        });

        renderAuditPanel();

        expect(await screen.findByText('structure.backup_renamed')).toBeTruthy();
        expect(screen.getByText('Backup target')).toBeTruthy();
        expect(screen.getByText('backup-1')).toBeTruthy();
        expect(screen.getByText('Guild/settings target')).toBeTruthy();
        expect(screen.getByText('guild-1')).toBeTruthy();
        expect(screen.getByText('Retention deleted')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(within(screen.getByRole('list', { name: 'Dashboard audit events' })).queryByText('Message')).toBeNull();
    });
});

function renderAuditPanel(): void {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    renderedPanels.push(
        render(
            <QueryClientProvider client={queryClient}>
                <DashboardAuditEventsPanel guildId='guild-1' />
            </QueryClientProvider>
        )
    );
}
