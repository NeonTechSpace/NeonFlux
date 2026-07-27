// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readDashboardAuditEventsRouteData } from '../server/dashboard-guild-route-data.js';
import type * as DashboardGuildRouteDataModule from '../server/dashboard-guild-route-data.js';
import type { DashboardAuditEventsInput } from '../server/dashboard-audit-events-model.js';
import { DashboardAuditEventsPanel } from './dashboard-audit-events-panel.js';

vi.mock('../server/dashboard-guild-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardGuildRouteDataModule>();

    return {
        ...actual,
        readDashboardAuditEventsRouteData: vi.fn(),
    };
});

const renderedPanels: RenderResult[] = [];

describe('DashboardAuditEventsPanel', () => {
    afterEach(() => {
        for (const renderedPanel of renderedPanels.splice(0)) {
            renderedPanel.unmount();
        }
        vi.clearAllMocks();
        window.history.replaceState({}, '', '/');
    });

    it('renders Blueprint run targets and metadata without message labels', async () => {
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValue({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'blueprint',
                    action: 'blueprint.run_partially_applied',
                    actorUserId: 'user-1',
                    actorUsername: 'operator',
                    targetId: 'run-1',
                    createdAt: '2026-07-09T10:00:00.000Z',
                    metadata: {
                        changeCount: 4,
                        appliedCount: 3,
                        failedCount: 1,
                        restorePointBackupId: 'backup-restore-1',
                    },
                },
            ],
        });
        renderAuditPanel();

        const action = await screen.findByText('Run partially applied');
        const eventDetails = screen.getByRole<HTMLDetailsElement>('listitem');

        expect(eventDetails.open).toBe(false);
        fireEvent.click(action);
        expect(eventDetails.open).toBe(true);
        expect(screen.getByText('blueprint.run_partially_applied')).toBeTruthy();
        expect(screen.getByText('Blueprint run')).toBeTruthy();
        expect(screen.getByText('run-1')).toBeTruthy();
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
                    feature: 'blueprint',
                    action: 'blueprint.backup_renamed',
                    targetId: 'backup-1',
                    createdAt: '2026-07-09T10:00:00.000Z',
                    metadata: { name: 'Before risky apply' },
                },
                {
                    id: 'event-2',
                    feature: 'blueprint',
                    action: 'blueprint.backup_retention_pruned',
                    targetId: 'guild-1',
                    createdAt: '2026-07-09T09:00:00.000Z',
                    metadata: { deletedCount: 2, source: 'scheduled_retention' },
                },
            ],
        });
        renderAuditPanel();

        expect(await screen.findByText('Backup renamed')).toBeTruthy();
        expect(screen.getByText('Backup target')).toBeTruthy();
        expect(screen.getByText('backup-1')).toBeTruthy();
        expect(screen.getByText('Guild/settings target')).toBeTruthy();
        expect(screen.getByText('guild-1')).toBeTruthy();
        expect(screen.getByText('Retention deleted')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(within(screen.getByRole('list', { name: 'Dashboard audit events' })).queryByText('Message')).toBeNull();
    });

    it('restores valid URL filters and keeps filter changes shareable', async () => {
        window.history.replaceState(
            {},
            '',
            '/dashboard/guild-1/events/audit-events?q=operator&scope=actor&retained=value'
        );
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValue({
            type: 'events',
            auditEvents: [],
        });
        renderAuditPanel();

        const searchInput = await screen.findByLabelText('Search events');
        const scopeSelect = screen.getByLabelText('Search in');

        await waitFor(() => {
            expect((searchInput as HTMLInputElement).value).toBe('operator');
            expect((scopeSelect as HTMLSelectElement).value).toBe('actor');
        });
        await waitFor(() =>
            expect(readDashboardAuditEventsRouteData).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    guildId: 'guild-1',
                    search: 'operator',
                    searchScope: 'actor',
                }),
            })
        );

        fireEvent.change(searchInput, { target: { value: 'message.sent' } });
        fireEvent.change(scopeSelect, { target: { value: 'event' } });

        await waitFor(() => {
            const url = new URL(window.location.href);

            expect(url.searchParams.get('q')).toBe('message.sent');
            expect(url.searchParams.get('scope')).toBe('event');
            expect(url.searchParams.get('retained')).toBe('value');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

        await waitFor(() => {
            const url = new URL(window.location.href);

            expect(url.searchParams.has('q')).toBe(false);
            expect(url.searchParams.has('scope')).toBe(false);
            expect(url.searchParams.get('retained')).toBe('value');
        });
    });

    it('keeps the audit failure visible while an explicit retry is in flight', async () => {
        vi.mocked(readDashboardAuditEventsRouteData)
            .mockResolvedValueOnce({ type: 'database-error' })
            .mockImplementationOnce(() => new Promise(() => undefined));
        renderAuditPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Retry audit events' }));
        const retrying = await screen.findByRole<HTMLButtonElement>('button', { name: 'Retrying…' });

        expect(retrying.disabled).toBe(true);
        expect(retrying.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('continues an empty search segment only after an explicit request', async () => {
        vi.mocked(readDashboardAuditEventsRouteData).mockImplementation((input) => {
            const data = input?.data as DashboardAuditEventsInput | undefined;

            if (!data?.search) {
                return Promise.resolve({
                    type: 'events',
                    auditEvents: [],
                });
            }

            if (!data.cursor) {
                return Promise.resolve({
                    type: 'events',
                    auditEvents: [],
                    nextCursor: 'older-segment',
                });
            }

            return Promise.resolve({
                type: 'events',
                auditEvents: [
                    {
                        id: 'event-older',
                        feature: 'future_feature',
                        action: 'future_feature.resource_reconciled',
                        createdAt: '2026-07-01T09:00:00.000Z',
                        metadata: {
                            attemptCount: 2,
                            failureReason: 'stale lease',
                            reconciled: false,
                        },
                    },
                ],
            });
        });

        window.history.replaceState({}, '', '/dashboard/guild-1/events/audit-events?q=reconciled&scope=event');
        renderAuditPanel();

        expect(await screen.findByText('No matches in the newest events')).toBeTruthy();
        expect(readDashboardAuditEventsRouteData).not.toHaveBeenCalledWith({
            data: expect.objectContaining({ cursor: 'older-segment' }),
        });

        fireEvent.click(screen.getByRole('button', { name: 'Search older events' }));

        const action = await screen.findByText('Resource reconciled');
        expect(readDashboardAuditEventsRouteData).toHaveBeenLastCalledWith({
            data: expect.objectContaining({
                cursor: 'older-segment',
                guildId: 'guild-1',
                search: 'reconciled',
            }),
        });

        fireEvent.click(action);
        const eventDetails = screen.getByRole<HTMLDetailsElement>('listitem');
        expect(within(eventDetails).getByText('2')).toBeTruthy();
        expect(within(eventDetails).getByText('stale lease')).toBeTruthy();
        expect(within(eventDetails).getByText('False')).toBeTruthy();
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
