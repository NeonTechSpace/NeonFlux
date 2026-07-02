// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMMAND_PREFIX_INVALID_MESSAGE } from '@neonflux/core/command-prefix';
import { RouterContextProvider, createRootRoute, createRoute, createRouter, isRedirect } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardCategoryId } from '../../dashboard-categories.js';
import {
    DashboardGuildAccessCategory,
    DashboardGuildAuditCategory,
    DashboardGuildCommunityCategory,
    DashboardGuildGeneralCategory,
    DashboardGuildInviteTrackingCategory,
    DashboardGuildLoggingCategory,
    DashboardGuildMessagingCategory,
    DashboardGuildModerationCategory,
    DashboardGuildOverviewCategory,
    DashboardGuildPageContent,
    DashboardGuildPendingPage,
    DashboardGuildStructureCategory,
} from '../../components/dashboard-guild-page.js';
import {
    postDashboardMessageRouteData,
    readDashboardAuditEventsRouteData,
    readDashboardCommandAccessRouteData,
    readDashboardCommandSettingsRouteData,
    readDashboardGuildOverviewRouteData,
    readDashboardModerationCasesRouteData,
    readDashboardModerationPolicyRouteData,
    readDashboardPostingChannelsRouteData,
    resolveDashboardGuildRouteResult,
    toDashboardGuildRouteResult,
    updateDashboardModerationPolicyRouteData,
    updateDashboardCommandPrefixRouteData,
} from '../../server/dashboard-guild-route-data.js';
import type { DashboardGuildRouteData } from '../../server/dashboard-guild-route-data.js';
import type * as DashboardGuildRouteDataModule from '../../server/dashboard-guild-route-data.js';
import { readDashboardAutoroleSettingsRouteData } from '../../server/dashboard-autorole-route-data.js';
import type * as DashboardAutoroleRouteDataModule from '../../server/dashboard-autorole-route-data.js';
import { readDashboardAutomodSettingsRouteData } from '../../server/dashboard-automod-route-data.js';
import type * as DashboardAutomodRouteDataModule from '../../server/dashboard-automod-route-data.js';
import { readDashboardLoggingSettingsRouteData } from '../../server/dashboard-logging-route-data.js';
import type * as DashboardLoggingRouteDataModule from '../../server/dashboard-logging-route-data.js';
import {
    deleteDashboardReactionRoleMessageRouteData,
    publishDashboardReactionRoleMessageRouteData,
    readDashboardReactionRolesSettingsRouteData,
    saveDashboardReactionRoleMessageRouteData,
} from '../../server/dashboard-reaction-roles-route-data.js';
import type * as DashboardReactionRolesRouteDataModule from '../../server/dashboard-reaction-roles-route-data.js';
import { readDashboardRoleReconciliationSettingsRouteData } from '../../server/dashboard-role-reconciliation-route-data.js';
import type * as DashboardRoleReconciliationRouteDataModule from '../../server/dashboard-role-reconciliation-route-data.js';
import { readDashboardVerificationSettingsRouteData } from '../../server/dashboard-verification-route-data.js';
import type * as DashboardVerificationRouteDataModule from '../../server/dashboard-verification-route-data.js';
import { readDashboardProfileBuilderSettingsRouteData } from '../../server/dashboard-profile-builder-route-data.js';
import type * as DashboardProfileBuilderRouteDataModule from '../../server/dashboard-profile-builder-route-data.js';
import { readDashboardGiveawaysSettingsRouteData } from '../../server/dashboard-giveaways-route-data.js';
import type * as DashboardGiveawaysRouteDataModule from '../../server/dashboard-giveaways-route-data.js';
import { readDashboardSuggestionsSettingsRouteData } from '../../server/dashboard-suggestions-route-data.js';
import type * as DashboardSuggestionsRouteDataModule from '../../server/dashboard-suggestions-route-data.js';
import { readDashboardTicketsSettingsRouteData } from '../../server/dashboard-tickets-route-data.js';
import type * as DashboardTicketsRouteDataModule from '../../server/dashboard-tickets-route-data.js';
import { readDashboardVcGeneratorSettingsRouteData } from '../../server/dashboard-vc-generator-route-data.js';
import type * as DashboardVcGeneratorRouteDataModule from '../../server/dashboard-vc-generator-route-data.js';
import { readDashboardXpSettingsRouteData } from '../../server/dashboard-xp-route-data.js';
import type * as DashboardXpRouteDataModule from '../../server/dashboard-xp-route-data.js';
import {
    applyDashboardStructureImportRunRouteData,
    createDashboardStructureDryRunRouteData,
    exportDashboardStructureRouteData,
    readDashboardStructureSettingsRouteData,
} from '../../server/dashboard-structure-route-data.js';
import type * as DashboardStructureRouteDataModule from '../../server/dashboard-structure-route-data.js';
import { readDashboardPostingTemplatesRouteData } from '../../server/dashboard-posting-templates-route-data.js';
import type * as DashboardPostingTemplatesRouteDataModule from '../../server/dashboard-posting-templates-route-data.js';

vi.mock('../../server/dashboard-guild-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardGuildRouteDataModule>();

    return {
        ...actual,
        postDashboardMessageRouteData: vi.fn(),
        readDashboardAuditEventsRouteData: vi.fn(),
        readDashboardCommandAccessRouteData: vi.fn(),
        readDashboardCommandSettingsRouteData: vi.fn(),
        readDashboardGuildOverviewRouteData: vi.fn(),
        readDashboardModerationCasesRouteData: vi.fn(),
        readDashboardModerationPolicyRouteData: vi.fn(),
        readDashboardPostingChannelsRouteData: vi.fn(),
        updateDashboardModerationPolicyRouteData: vi.fn(),
        updateDashboardCommandPrefixRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-autorole-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardAutoroleRouteDataModule>();

    return {
        ...actual,
        readDashboardAutoroleSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-automod-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardAutomodRouteDataModule>();

    return {
        ...actual,
        readDashboardAutomodSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-logging-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardLoggingRouteDataModule>();

    return {
        ...actual,
        readDashboardLoggingSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-reaction-roles-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardReactionRolesRouteDataModule>();

    return {
        ...actual,
        deleteDashboardReactionRoleMessageRouteData: vi.fn(),
        publishDashboardReactionRoleMessageRouteData: vi.fn(),
        readDashboardReactionRolesSettingsRouteData: vi.fn(),
        saveDashboardReactionRoleMessageRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-role-reconciliation-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardRoleReconciliationRouteDataModule>();

    return {
        ...actual,
        readDashboardRoleReconciliationSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-verification-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardVerificationRouteDataModule>();

    return {
        ...actual,
        readDashboardVerificationSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-profile-builder-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardProfileBuilderRouteDataModule>();

    return {
        ...actual,
        readDashboardProfileBuilderSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-giveaways-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardGiveawaysRouteDataModule>();

    return {
        ...actual,
        readDashboardGiveawaysSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-suggestions-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardSuggestionsRouteDataModule>();

    return {
        ...actual,
        readDashboardSuggestionsSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-tickets-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardTicketsRouteDataModule>();

    return {
        ...actual,
        readDashboardTicketsSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-vc-generator-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardVcGeneratorRouteDataModule>();

    return {
        ...actual,
        readDashboardVcGeneratorSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-xp-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardXpRouteDataModule>();

    return {
        ...actual,
        readDashboardXpSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-structure-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardStructureRouteDataModule>();

    return {
        ...actual,
        applyDashboardStructureImportRunRouteData: vi.fn(),
        createDashboardStructureDryRunRouteData: vi.fn(),
        exportDashboardStructureRouteData: vi.fn(),
        readDashboardStructureSettingsRouteData: vi.fn(),
    };
});

vi.mock('../../server/dashboard-posting-templates-route-data.js', async (importActual) => {
    const actual = await importActual<typeof DashboardPostingTemplatesRouteDataModule>();

    return {
        ...actual,
        readDashboardPostingTemplatesRouteData: vi.fn(),
    };
});

const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const fluxerUserId = '1517169145576165376';
const accessToken = 'fresh-access-token';
const botInviteUrl =
    'https://web.canary.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8';
let renderedViews: Array<ReturnType<typeof render>> = [];
let documentVisibilityState = 'visible';

describe('/dashboard/$guildId', () => {
    beforeEach(() => {
        MockEventSource.instances = [];
        documentVisibilityState = 'visible';
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => documentVisibilityState,
        });
        vi.stubGlobal('EventSource', MockEventSource);
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValue({
            type: 'events',
            auditEvents: [],
        });
        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValue({
            type: 'overview',
            overview: createDashboardOverview(),
        });
        vi.mocked(readDashboardModerationCasesRouteData).mockResolvedValue({
            type: 'cases',
            cases: [],
        });
        vi.mocked(readDashboardModerationPolicyRouteData).mockResolvedValue({
            type: 'policy',
            policy: {
                protectedUserIds: [],
                protectedRoleIds: [],
            },
            structureReadStatus: 'available',
            roles: [{ id: 'role-1', name: 'Moderator', position: 10, color: 0x38bdf8 }],
        });
        vi.mocked(readDashboardPostingChannelsRouteData).mockResolvedValue({
            type: 'channels',
            channels: [
                {
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    position: 1,
                },
                {
                    id: 'channel-2',
                    name: 'release-notes',
                    type: 0,
                    parentId: 'category-1',
                    parentName: 'Info',
                    position: 2,
                },
            ],
        });
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValue(createCommandSettingsReadResult('?'));
        vi.mocked(readDashboardCommandAccessRouteData).mockResolvedValue(createCommandAccessReadResult());
        vi.mocked(readDashboardAutoroleSettingsRouteData).mockResolvedValue(createAutoroleSettingsReadResult());
        vi.mocked(readDashboardAutomodSettingsRouteData).mockResolvedValue({
            type: 'settings',
            structureReadStatus: 'available',
            channels: [{ id: 'channel-1', name: 'general', type: 0, position: 1 }],
            roles: [{ id: 'role-1', name: 'Moderator', position: 10, color: 0x38bdf8 }],
            rules: [],
            events: [],
        });
        vi.mocked(readDashboardReactionRolesSettingsRouteData).mockResolvedValue(
            createReactionRolesSettingsReadResult()
        );
        vi.mocked(publishDashboardReactionRoleMessageRouteData).mockResolvedValue({
            type: 'published',
            message: createReactionRolesSettingsReadResult().messages[0],
            seedFailures: [],
        });
        vi.mocked(saveDashboardReactionRoleMessageRouteData).mockResolvedValue({
            type: 'saved',
            message: createReactionRolesSettingsReadResult().messages[0],
            seedFailures: [],
            cleanupFailures: [],
        });
        vi.mocked(deleteDashboardReactionRoleMessageRouteData).mockResolvedValue({
            type: 'deleted',
            message: createReactionRolesSettingsReadResult().messages[0],
        });
        vi.mocked(readDashboardRoleReconciliationSettingsRouteData).mockResolvedValue(
            createRoleReconciliationSettingsReadResult()
        );
        vi.mocked(readDashboardVerificationSettingsRouteData).mockResolvedValue(createVerificationSettingsReadResult());
        vi.mocked(readDashboardVcGeneratorSettingsRouteData).mockResolvedValue(createVcGeneratorSettingsReadResult());
        vi.mocked(readDashboardXpSettingsRouteData).mockResolvedValue(createXpSettingsReadResult());
        vi.mocked(readDashboardProfileBuilderSettingsRouteData).mockResolvedValue(
            createProfileBuilderSettingsReadResult()
        );
        vi.mocked(readDashboardGiveawaysSettingsRouteData).mockResolvedValue(createGiveawaysSettingsReadResult());
        vi.mocked(readDashboardTicketsSettingsRouteData).mockResolvedValue(createTicketsSettingsReadResult());
        vi.mocked(readDashboardSuggestionsSettingsRouteData).mockResolvedValue(createSuggestionsSettingsReadResult());
        vi.mocked(readDashboardLoggingSettingsRouteData).mockResolvedValue(createLoggingSettingsReadResult());
        vi.mocked(readDashboardStructureSettingsRouteData).mockResolvedValue(createStructureSettingsReadResult());
        vi.mocked(readDashboardPostingTemplatesRouteData).mockResolvedValue({
            type: 'templates',
            templates: [],
        });
        vi.mocked(exportDashboardStructureRouteData).mockResolvedValue({
            type: 'exported',
            exportSnapshot: createStructureExportSummary(),
            snapshotJson: JSON.stringify({ version: 1, roles: [], categories: [], channels: [] }, null, 2),
        });
        vi.mocked(createDashboardStructureDryRunRouteData).mockResolvedValue({
            type: 'dry-run-created',
            importRun: createStructureImportRun(),
        });
        vi.mocked(applyDashboardStructureImportRunRouteData).mockResolvedValue({
            type: 'applied',
            importRun: { ...createStructureImportRun(), status: 'applied' },
        });
        vi.mocked(postDashboardMessageRouteData).mockResolvedValue({
            type: 'sent',
            message: {
                id: 'message-1',
                guildId: 'guild-1',
                channelId: 'channel-1',
            },
        });
        vi.mocked(updateDashboardModerationPolicyRouteData).mockResolvedValue({
            type: 'updated',
            policy: {
                protectedUserIds: ['user-1'],
                protectedRoleIds: ['role-1'],
                updatedAt: '2026-06-26T10:00:00.000Z',
            },
        });
        vi.mocked(updateDashboardCommandPrefixRouteData).mockResolvedValue({
            type: 'updated',
            commandSettings: {
                prefix: '?',
                isDefaultPrefix: false,
            },
        });
    });

    afterEach(() => {
        for (const renderedView of renderedViews) {
            renderedView.unmount();
        }
        renderedViews = [];
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('maps authorized guild data into route data', () => {
        expect(toDashboardGuildRouteResult(createGuildData())).toStrictEqual(createGuildRouteData());
    });

    it('redirects unauthenticated route results to Fluxer login', () => {
        let thrownError: unknown;

        try {
            resolveDashboardGuildRouteResult({ type: 'auth-required' });
        } catch (error) {
            thrownError = error;
        }

        expect(thrownError).toBeInstanceOf(Response);
        expect(isRedirect(thrownError)).toBe(true);
        expect(getRedirectOptions(thrownError)).toMatchObject({
            to: '/auth/fluxer/login',
            reloadDocument: true,
        });
    });

    it('maps inaccessible guilds to a generic 404 state', () => {
        expect(toDashboardGuildRouteResult({ type: 'not-found' })).toStrictEqual({
            type: 'unavailable',
            status: 404,
            title: 'Community unavailable',
            message: 'This community is not available for this account.',
        });
    });

    it('maps infrastructure failures to unavailable states', () => {
        expect(toDashboardGuildRouteResult({ type: 'database-error' })).toStrictEqual({
            type: 'unavailable',
            status: 500,
            title: 'Dashboard unavailable',
            message: 'NeonFlux dashboard unavailable.',
        });
        expect(toDashboardGuildRouteResult({ type: 'deployment-config-not-found' })).toStrictEqual({
            type: 'unavailable',
            status: 503,
            title: 'Dashboard unavailable',
            message: 'NeonFlux deployment config unavailable.',
        });
        expect(toDashboardGuildRouteResult({ type: 'guild-lookup-failed' })).toStrictEqual({
            type: 'unavailable',
            status: 502,
            title: 'Dashboard unavailable',
            message: 'NeonFlux dashboard unavailable.',
        });
    });

    it('renders the authorized guild overview category by default', async () => {
        renderGuildPage();

        expect(await screen.findByRole('heading', { name: 'Guild One' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Guild One icon' })).toBeTruthy();
        expect(screen.getByText('guild-1')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Overview' })).toBeTruthy();
        expect(await screen.findByText('Last 30 days')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Member flow' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Message activity' })).toBeTruthy();
        expect(screen.queryByText('No joins or leaves in this window.')).toBeNull();
        expect(screen.queryByText('No message activity in this window.')).toBeNull();
        expect(screen.queryByText(/chart stays/u)).toBeNull();
        expect(screen.queryByText('Data health')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Top inviters' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Audit events' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Instance mode' })).toBeNull();
        expect(screen.queryByText('This bot can manage multiple servers.')).toBeNull();
        expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
        expect(screen.getByRole('link', { name: 'General' }).getAttribute('href')).toBe('/dashboard/guild-1/general');
        expect(screen.getByRole('link', { name: 'Messaging' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/messaging'
        );
        expect(screen.getByRole('link', { name: 'Invite Tracking' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/invites'
        );
        expect(screen.getByRole('link', { name: 'Audit Events' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/audit'
        );
        expect(screen.getAllByRole('navigation', { name: 'Servers' }).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Show server picker' }));
        expect(screen.getAllByRole('link', { name: 'Invite bot' })[0]?.getAttribute('href')).toBe(botInviteUrl);
        expect(screen.queryByRole('link', { name: 'Guild One' })).toBeNull();
        expect(screen.getAllByRole('link', { name: 'Guild Two' })[0]?.getAttribute('href')).toBe('/dashboard/guild-2');
    });

    it('does not render a server selector in single-instance guild mode', async () => {
        const routeData = createGuildRouteData();

        renderGuildPage(
            {
                ...routeData,
                mode: 'single',
                manageableGuilds: [routeData.guild],
            },
            'overview'
        );

        expect(await screen.findByRole('heading', { name: 'Guild One' })).toBeTruthy();
        expect(screen.queryByRole('navigation', { name: 'Servers' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Show server picker' })).toBeNull();
    });

    it('renders populated overview metrics and graph data without invite tracker details', async () => {
        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValueOnce({
            type: 'overview',
            overview: createDashboardOverview({
                trackingStartedAt: '2026-06-25T00:00:00.000Z',
                memberFlow: {
                    totalJoins: 3,
                    totalLeaves: 1,
                    netGrowth: 2,
                    graph: [
                        { date: '2026-06-25', joins: 2, leaves: 0, netGrowth: 2 },
                        { date: '2026-06-26', joins: 1, leaves: 1, netGrowth: 0 },
                    ],
                },
                invites: {
                    activeInviteCount: 3,
                    totalInviteUses: 16,
                    attribution: {
                        attributed: 3,
                        baselineMissing: 0,
                        ambiguous: 0,
                        unavailable: 1,
                        notApplicable: 1,
                    },
                    topInviters: [
                        {
                            inviterUserId: 'inviter-1',
                            attributedJoins: 3,
                            inviteCodes: [
                                { code: 'alpha', uses: 5, active: true },
                                { code: 'beta', uses: 3, active: true },
                            ],
                        },
                        {
                            inviterUserId: 'inviter-2',
                            attributedJoins: 1,
                            inviteCodes: [{ code: 'gamma', uses: 8, active: true }],
                        },
                    ],
                },
                messages: {
                    totalMessages: 12,
                    graph: [
                        { date: '2026-06-25', messageCount: 4 },
                        { date: '2026-06-26', messageCount: 8 },
                    ],
                    topChannels: [{ channelId: 'channel-1', messageCount: 12 }],
                },
                dataHealth: {
                    hasMemberFlow: true,
                    hasInviteSnapshots: true,
                    hasMessageActivity: true,
                },
            }),
        });

        renderGuildPage();

        expect(await screen.findByText('+2')).toBeTruthy();
        expect(screen.getByText('3 joins / 1 leaves')).toBeTruthy();
        expect(screen.getByText('12 in busiest channel')).toBeTruthy();
        expect(screen.queryByText('16 tracked uses')).toBeNull();
        expect(screen.queryByText('alpha · 5 uses')).toBeNull();
        expect(screen.queryByRole('region', { name: 'Top inviters' })).toBeNull();
    });

    it('renders the routed invite tracking category with grouped top inviters', async () => {
        vi.mocked(readDashboardGuildOverviewRouteData).mockResolvedValueOnce({
            type: 'overview',
            overview: createDashboardOverview({
                invites: {
                    activeInviteCount: 3,
                    totalInviteUses: 16,
                    attribution: {
                        attributed: 3,
                        baselineMissing: 0,
                        ambiguous: 0,
                        unavailable: 1,
                        notApplicable: 1,
                    },
                    topInviters: [
                        {
                            inviterUserId: 'inviter-1',
                            attributedJoins: 3,
                            inviteCodes: [
                                { code: 'alpha', uses: 5, active: true },
                                { code: 'beta', uses: 3, active: true },
                            ],
                        },
                        {
                            inviterUserId: 'inviter-2',
                            attributedJoins: 1,
                            inviteCodes: [{ code: 'gamma', uses: 8, active: true }],
                        },
                    ],
                },
                dataHealth: {
                    hasMemberFlow: false,
                    hasInviteSnapshots: true,
                    hasMessageActivity: false,
                },
            }),
        });

        renderGuildPage(createGuildRouteData(), 'invites');

        expect(await screen.findByRole('region', { name: 'Invite Tracking' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Top inviters' })).toBeTruthy();
        expect(screen.getByText('Active invites')).toBeTruthy();
        expect(screen.getByText('16 tracked uses')).toBeTruthy();
        expect(screen.getByText('alpha · 5 uses')).toBeTruthy();
        expect(screen.getByText('beta · 3 uses')).toBeTruthy();
        expect(screen.getByText('gamma · 8 uses')).toBeTruthy();
        expect(screen.getByText('1 joins could not be attributed because invite data was unavailable.')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Invite Tracking' }).getAttribute('aria-current')).toBe('page');

        const topInvitersPanel = screen.getByRole('region', { name: 'Top inviters' });

        fireEvent.change(within(topInvitersPanel).getByLabelText('Sort inviters'), { target: { value: 'uses' } });

        expect(within(topInvitersPanel).getByLabelText<HTMLSelectElement>('Sort inviters').value).toBe('uses');
    });

    it('renders the routed general category', async () => {
        renderGuildPage(createGuildRouteData(), 'general');

        expect(await screen.findByRole('region', { name: 'General' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Command prefix' })).toBeTruthy();
        expect(screen.getByText('Current prefix:')).toBeTruthy();
        expect(screen.getByText('?')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
    });

    it('renders the routed messaging category', async () => {
        renderGuildPage(createGuildRouteData(), 'messaging');

        expect(await screen.findByRole('region', { name: 'Messaging' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Posting' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Messaging' }).getAttribute('aria-current')).toBe('page');
    });

    it('renders the routed structure category with import/export tools', async () => {
        renderGuildPage(createGuildRouteData(), 'structure');

        expect(await screen.findByRole('region', { name: 'Structure' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Import and export' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create dry-run' })).toBeTruthy();
        expect(screen.queryByText('Structure is not built yet')).toBeNull();
        expect(screen.getByRole('link', { name: 'Structure' }).getAttribute('aria-current')).toBe('page');
    });

    it('renders the routed audit category', async () => {
        renderGuildPage(createGuildRouteData(), 'audit');

        expect(await screen.findByRole('region', { name: 'Audit Events' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Audit events' })).toBeTruthy();
        expect(screen.getByLabelText('Search events')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Audit Events' }).getAttribute('aria-current')).toBe('page');
    });

    it('renders the routed moderation category with recent case history', async () => {
        vi.mocked(readDashboardModerationCasesRouteData).mockResolvedValueOnce({
            type: 'cases',
            cases: [
                {
                    caseNumber: 3,
                    action: 'ban',
                    status: 'resolved',
                    targetType: 'user',
                    targetUserId: 'target-3',
                    actorUserId: 'mod-1',
                    reason: 'Raid account',
                    createdAt: '2026-06-26T10:00:00.000Z',
                    updatedAt: '2026-06-26T10:01:00.000Z',
                },
                {
                    caseNumber: 2,
                    action: 'kick',
                    status: 'void',
                    targetType: 'user',
                    targetUserId: 'target-2',
                    actorUserId: 'mod-1',
                    createdAt: '2026-06-26T09:00:00.000Z',
                    updatedAt: '2026-06-26T09:01:00.000Z',
                },
            ],
        });

        renderGuildPage(createGuildRouteData(), 'moderation');

        expect(await screen.findByRole('region', { name: 'Moderation' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Automod' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Protection policy' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Case history' })).toBeTruthy();
        expect(screen.getByText('#3')).toBeTruthy();
        expect(screen.getByText('ban')).toBeTruthy();
        expect(screen.getByText('resolved')).toBeTruthy();
        expect(screen.getByText('target-3')).toBeTruthy();
        expect(screen.getByText('Raid account')).toBeTruthy();
        expect(screen.getByText('#2')).toBeTruthy();
        expect(screen.getByText('void')).toBeTruthy();
        expect(readDashboardModerationCasesRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
        expect(readDashboardModerationPolicyRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
        expect(screen.getByRole('link', { name: 'Moderation' }).getAttribute('aria-current')).toBe('page');
    });

    it('saves moderation protection policy from the dashboard', async () => {
        renderGuildPage(createGuildRouteData(), 'moderation');

        fireEvent.change(await screen.findByLabelText('Protected roles'), {
            target: { value: 'Moderator' },
        });
        fireEvent.click(screen.getByRole('button', { name: /@Moderator/u }));
        fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));

        await waitFor(() => expect(updateDashboardModerationPolicyRouteData).toHaveBeenCalled());
        expect(updateDashboardModerationPolicyRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
                protectedUserIds: [],
                protectedRoleIds: ['role-1'],
            },
        });
        expect(await screen.findByText('Moderation policy saved.')).toBeTruthy();
    });

    it('navigates from the category navigation', async () => {
        const view = renderGuildPage();

        fireEvent.click(screen.getByRole('link', { name: 'Audit Events' }));

        await waitFor(() => expect(view.router.state.location.pathname).toBe('/dashboard/guild-1/audit'));
    });

    it('renders active logging destinations', async () => {
        renderGuildPage(createGuildRouteData(), 'logging');

        expect(await screen.findByRole('region', { name: 'Logging' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Server event destinations' })).toBeTruthy();
        expect(screen.getByText('Messages')).toBeTruthy();
        expect(readDashboardLoggingSettingsRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
    });

    it('renders the routed community category with XP settings', async () => {
        renderGuildPage(createGuildRouteData(), 'community');

        expect(await screen.findByRole('region', { name: 'Community' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'XP rules' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Giveaways' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'VC generator' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Profile builder' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Tickets' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Suggestions' })).toBeNull();
        const communityDisclosure = screen.getByRole('button', { name: 'Collapse Community' });
        expect(communityDisclosure).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Giveaways' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/community/giveaways'
        );
        expect(screen.getByRole('link', { name: 'Profile Builder' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/community/profile-builder'
        );
        expect(screen.getByRole('link', { name: 'Voice Rooms' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/community/vc-generator'
        );
        expect(screen.getByRole('link', { name: 'Tickets' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/community/tickets'
        );
        expect(screen.getByRole('link', { name: 'Suggestions' }).getAttribute('href')).toBe(
            '/dashboard/guild-1/community/suggestions'
        );
        fireEvent.click(communityDisclosure);
        expect(screen.getByRole('button', { name: 'Expand Community' })).toBeTruthy();
        await waitFor(() => expect(screen.queryByRole('link', { name: 'Giveaways' })).toBeNull());
        expect(readDashboardXpSettingsRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
        expect(readDashboardVcGeneratorSettingsRouteData).not.toHaveBeenCalled();
        expect(readDashboardProfileBuilderSettingsRouteData).not.toHaveBeenCalled();
        expect(readDashboardGiveawaysSettingsRouteData).not.toHaveBeenCalled();
        expect(readDashboardTicketsSettingsRouteData).not.toHaveBeenCalled();
        expect(readDashboardSuggestionsSettingsRouteData).not.toHaveBeenCalled();
    });

    it('renders command access without granting dashboard access', async () => {
        renderGuildPage(createGuildRouteData(), 'access');

        expect(await screen.findByRole('region', { name: 'Roles & Access' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Add join role' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Reaction roles' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Verification' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Role reconciliation' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Command access' })).toBeTruthy();
        expect((await screen.findAllByText('@Member')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('unicode:check').length).toBeGreaterThan(0);
        expect(screen.getByText('Verified')).toBeTruthy();
        expect(screen.getByText('Add or update grant')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save command grant' })).toBeTruthy();
        expect(screen.getByText('Manage Server is still required for dashboard access.')).toBeTruthy();
        expect(readDashboardAutoroleSettingsRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
        expect(readDashboardReactionRolesSettingsRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
        expect(readDashboardVerificationSettingsRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
        expect(readDashboardRoleReconciliationSettingsRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
        expect(readDashboardCommandAccessRouteData).toHaveBeenCalledWith({
            data: {
                guildId: 'guild-1',
            },
        });
    });

    it('publishes a reaction-role menu from the dashboard builder', async () => {
        renderGuildPage(createGuildRouteData(), 'access');

        await screen.findByRole('article', { name: 'Reaction roles' });
        fireEvent.click(screen.getByRole('button', { name: 'Create menu' }));

        const reactionRoleBuilder = within(await screen.findByRole('form', { name: 'Create reaction-role menu' }));
        const channelInput = reactionRoleBuilder.getByPlaceholderText('Search channels');
        fireEvent.focus(channelInput);
        fireEvent.change(channelInput, { target: { value: 'roles' } });
        fireEvent.click(await reactionRoleBuilder.findByRole('button', { name: /#roles/u }));
        fireEvent.click(reactionRoleBuilder.getByRole('button', { name: 'Exclusive' }));
        fireEvent.change(reactionRoleBuilder.getByLabelText('Message content'), {
            target: { value: 'Pick roles:\n{list}' },
        });
        fireEvent.click(reactionRoleBuilder.getByRole('button', { name: '✅' }));

        const roleInput = reactionRoleBuilder.getByPlaceholderText('Search roles');
        fireEvent.change(roleInput, { target: { value: 'member' } });
        fireEvent.click(await reactionRoleBuilder.findByRole('button', { name: /@Member/u }));
        fireEvent.click(reactionRoleBuilder.getByRole('button', { name: 'Add option' }));
        fireEvent.click(reactionRoleBuilder.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => {
            expect(publishDashboardReactionRoleMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    content: 'Pick roles:\n{list}',
                    embeds: [],
                    mode: 'exclusive',
                    generateOverview: true,
                    options: [
                        {
                            emojiKey: '✅',
                            emojiLabel: '✅',
                            roleId: 'role-1',
                            position: 0,
                        },
                    ],
                },
            });
        });
    });

    it('edits existing reaction-role menus only after saving the draft', async () => {
        renderGuildPage(createGuildRouteData(), 'access');

        const reactionRoleMenus = within(await screen.findByRole('region', { name: 'Reaction-role menus' }));
        fireEvent.click(reactionRoleMenus.getByRole('button', { name: 'Edit' }));

        const editor = within(await screen.findByRole('form', { name: 'Edit reaction-role menu' }));
        fireEvent.click(editor.getByRole('button', { name: 'Exclusive' }));
        expect(saveDashboardReactionRoleMessageRouteData).not.toHaveBeenCalled();

        fireEvent.click(editor.getByRole('button', { name: '⭐' }));

        const roleInput = editor.getByPlaceholderText('Search roles');
        fireEvent.change(roleInput, { target: { value: 'member' } });
        fireEvent.click(await editor.findByRole('button', { name: /@Member/u }));
        fireEvent.click(editor.getByRole('button', { name: 'Add option' }));
        expect(saveDashboardReactionRoleMessageRouteData).not.toHaveBeenCalled();

        fireEvent.click(editor.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => {
            expect(saveDashboardReactionRoleMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    messageId: 'message-1',
                    content: 'Pick roles',
                    embeds: [],
                    mode: 'exclusive',
                    generateOverview: false,
                    options: [
                        {
                            emojiKey: 'unicode:check',
                            emojiLabel: 'unicode:check',
                            roleId: 'role-1',
                            position: 0,
                        },
                        {
                            emojiKey: '⭐',
                            emojiLabel: '⭐',
                            roleId: 'role-1',
                            position: 1,
                        },
                    ],
                },
            });
        });
    });

    it('sorts draft reaction-role options alphabetically before save', async () => {
        renderGuildPage(createGuildRouteData(), 'access');

        fireEvent.click(await screen.findByRole('button', { name: 'Create menu' }));
        const editor = within(await screen.findByRole('form', { name: 'Create reaction-role menu' }));
        const channelInput = editor.getByPlaceholderText('Search channels');
        fireEvent.focus(channelInput);
        fireEvent.change(channelInput, { target: { value: 'roles' } });
        fireEvent.click(await editor.findByRole('button', { name: /#roles/u }));
        fireEvent.change(editor.getByLabelText('Message content'), { target: { value: 'Pick roles' } });

        fireEvent.click(editor.getByRole('button', { name: '⭐' }));
        const firstRoleInput = editor.getByPlaceholderText('Search roles');
        fireEvent.change(firstRoleInput, { target: { value: 'zeta' } });
        fireEvent.click(await editor.findByRole('button', { name: /@Zeta/u }));
        fireEvent.click(editor.getByRole('button', { name: 'Add option' }));

        fireEvent.click(editor.getByRole('button', { name: '✅' }));
        const secondRoleInput = editor.getByPlaceholderText('Search roles');
        fireEvent.change(secondRoleInput, { target: { value: 'member' } });
        fireEvent.click(await editor.findByRole('button', { name: /@Member/u }));
        fireEvent.click(editor.getByRole('button', { name: 'Add option' }));

        fireEvent.click(editor.getByRole('button', { name: 'Sort alphabetically' }));
        fireEvent.click(editor.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => {
            expect(publishDashboardReactionRoleMessageRouteData).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    options: [
                        expect.objectContaining({ emojiKey: '✅', roleId: 'role-1', position: 0 }),
                        expect.objectContaining({ emojiKey: '⭐', roleId: 'role-zeta', position: 1 }),
                    ],
                }),
            });
        });
    });

    it('shows a reaction sync warning after saving an existing reaction-role menu', async () => {
        vi.mocked(saveDashboardReactionRoleMessageRouteData).mockResolvedValueOnce({
            type: 'saved-with-reaction-errors',
            message: createReactionRolesSettingsReadResult().messages[0],
            seedFailures: ['⭐'],
            cleanupFailures: [],
        });

        renderGuildPage(createGuildRouteData(), 'access');

        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        const editor = within(await screen.findByRole('form', { name: 'Edit reaction-role menu' }));
        fireEvent.click(editor.getByRole('button', { name: '⭐' }));

        const roleInput = editor.getByPlaceholderText('Search roles');
        fireEvent.change(roleInput, { target: { value: 'member' } });
        fireEvent.click(await editor.findByRole('button', { name: /@Member/u }));
        fireEvent.click(editor.getByRole('button', { name: 'Add option' }));
        fireEvent.click(editor.getByRole('button', { name: 'Save changes' }));

        expect(await screen.findByText('Menu saved, but one or more reactions could not be synced.')).toBeTruthy();
    });

    it('cancels existing reaction-role menu edits without saving', async () => {
        renderGuildPage(createGuildRouteData(), 'access');

        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        const editor = within(await screen.findByRole('form', { name: 'Edit reaction-role menu' }));
        fireEvent.click(editor.getByRole('button', { name: 'Exclusive' }));
        fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));

        expect(saveDashboardReactionRoleMessageRouteData).not.toHaveBeenCalled();
        expect(await screen.findByRole('region', { name: 'Reaction-role menus' })).toBeTruthy();
    });

    it('shows an empty reaction-role state that prompts the first menu', async () => {
        vi.mocked(readDashboardReactionRolesSettingsRouteData).mockResolvedValueOnce({
            ...createReactionRolesSettingsReadResult(),
            messages: [],
        });

        renderGuildPage(createGuildRouteData(), 'access');

        expect(await screen.findByText('Create your first reaction-role menu')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create first reaction-role menu' }));

        expect(await screen.findByRole('form', { name: 'Create reaction-role menu' })).toBeTruthy();
    });

    it('deletes reaction-role menus from the overview as a separate action', async () => {
        renderGuildPage(createGuildRouteData(), 'access');

        const reactionRoleMenus = within(await screen.findByRole('region', { name: 'Reaction-role menus' }));
        fireEvent.click(reactionRoleMenus.getByRole('button', { name: 'Delete' }));

        await waitFor(() => {
            expect(deleteDashboardReactionRoleMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    messageId: 'message-1',
                },
            });
        });
    });

    it('shows a cleanup warning when saving after removing an option cannot sync reactions', async () => {
        vi.mocked(readDashboardReactionRolesSettingsRouteData).mockResolvedValueOnce(
            createReactionRolesSettingsReadResult({
                options: [
                    createReactionRoleOptionReadResult({ emojiKey: 'unicode:check', roleId: 'role-1', position: 0 }),
                    createReactionRoleOptionReadResult({
                        emojiKey: '⭐',
                        emojiLabel: '⭐',
                        roleId: 'role-1',
                        position: 1,
                    }),
                ],
            })
        );
        vi.mocked(saveDashboardReactionRoleMessageRouteData).mockResolvedValueOnce({
            type: 'saved-with-reaction-errors',
            message: createReactionRolesSettingsReadResult().messages[0],
            seedFailures: [],
            cleanupFailures: ['unicode:check'],
        });

        renderGuildPage(createGuildRouteData(), 'access');

        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        const editor = within(await screen.findByRole('form', { name: 'Edit reaction-role menu' }));
        fireEvent.click(editor.getAllByRole('button', { name: 'Remove' })[0]);
        fireEvent.click(editor.getByRole('button', { name: 'Save changes' }));

        expect(await screen.findByText('Menu saved, but one or more reactions could not be synced.')).toBeTruthy();
    });

    it('renders preview guild data only for pending SPA navigation', () => {
        renderWithRouter(
            createElement(DashboardGuildPendingPage, {
                guildId: 'guild-1',
                preview: {
                    id: 'guild-1',
                    name: 'Preview Guild',
                    iconUrl: 'https://fluxerusercontent.com/icons/guild-1/preview.webp?size=80',
                    mode: 'multi',
                },
            })
        );

        expect(screen.getByRole('heading', { name: 'Preview Guild' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Preview Guild icon' })).toBeTruthy();
        expect(screen.getByText('guild-1')).toBeTruthy();
        expect(screen.getAllByText('Loading settings').length).toBeGreaterThan(0);
        expect(screen.getByRole('navigation', { name: 'Dashboard categories' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Overview' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Messaging' })).toBeTruthy();
    });

    it('renders no direct-entry pending shell while auth is unresolved', () => {
        const view = renderWithRouter(createElement(DashboardGuildPendingPage, { guildId: 'guild-1' }));

        expect(view.container.textContent).toBe('');
        expect(screen.queryByText('Loading server')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Loading server...' })).toBeNull();
        expect(screen.queryByText('Server ID: guild-1')).toBeNull();
        expect(screen.queryByText('Loading server settings for this section.')).toBeNull();
        expect(screen.queryByText('Dashboard')).toBeNull();
        expect(screen.queryByText('Server guild-1')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Choose server' })).toBeNull();
    });

    it('uses route command settings without a first-load command-settings refetch waterfall', async () => {
        renderGuildPage(createGuildRouteData(), 'general');

        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        expect(readDashboardCommandSettingsRouteData).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
        );
    });

    it('invalidates command settings when a visible matching live event arrives', async () => {
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValueOnce(createCommandSettingsReadResult('$'));

        renderGuildPage(createGuildRouteData(), 'general');
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
        );
        MockEventSource.instances.at(0)?.emit(
            'guild-feature-settings.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'commands',
                event: 'guild-feature-settings.changed',
            })
        );

        await waitFor(() => expect(readDashboardCommandSettingsRouteData).toHaveBeenCalled());
        expect(screen.getByText('$')).toBeTruthy();
    });

    it('invalidates overview metrics when an overview live event arrives', async () => {
        renderGuildPage(createGuildRouteData(), 'overview');
        await screen.findByText('Member change');
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=overview')
        );
        await waitFor(() => expect(readDashboardGuildOverviewRouteData).toHaveBeenCalledTimes(1));
        vi.mocked(readDashboardGuildOverviewRouteData).mockClear();

        MockEventSource.instances.at(0)?.emit(
            'overview.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'overview',
                event: 'overview.changed',
            })
        );

        await waitFor(() => expect(readDashboardGuildOverviewRouteData).toHaveBeenCalledTimes(1));
    });

    it('invalidates invite tracking when an invite live event arrives', async () => {
        renderGuildPage(createGuildRouteData(), 'invites');
        await screen.findByText('Invite attribution');
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=invites')
        );
        await waitFor(() => expect(readDashboardGuildOverviewRouteData).toHaveBeenCalledTimes(1));
        vi.mocked(readDashboardGuildOverviewRouteData).mockClear();

        MockEventSource.instances.at(0)?.emit(
            'invites.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'invites',
                event: 'invites.changed',
            })
        );

        await waitFor(() => expect(readDashboardGuildOverviewRouteData).toHaveBeenCalledTimes(1));
    });

    it('invalidates posting templates when a posting live event arrives', async () => {
        renderGuildPage(createGuildRouteData(), 'messaging');
        await screen.findByText('Templates');
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=posting')
        );
        await waitFor(() => expect(readDashboardPostingTemplatesRouteData).toHaveBeenCalledTimes(1));
        vi.mocked(readDashboardPostingTemplatesRouteData).mockClear();

        MockEventSource.instances.at(0)?.emit(
            'posting-templates.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'posting',
                event: 'posting-templates.changed',
            })
        );

        await waitFor(() => expect(readDashboardPostingTemplatesRouteData).toHaveBeenCalledTimes(1));
    });

    it('invalidates structure tools when a structure live event arrives', async () => {
        renderGuildPage(createGuildRouteData(), 'structure');
        await screen.findByText('Structure tools');
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe(
                '/dashboard/guild-1/events?areas=import_export%2Cstructure'
            )
        );
        await waitFor(() => expect(readDashboardStructureSettingsRouteData).toHaveBeenCalledTimes(1));
        vi.mocked(readDashboardStructureSettingsRouteData).mockClear();

        MockEventSource.instances.at(0)?.emit(
            'structure.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'structure',
                event: 'structure.changed',
            })
        );

        await waitFor(() => expect(readDashboardStructureSettingsRouteData).toHaveBeenCalledTimes(1));
        vi.mocked(readDashboardStructureSettingsRouteData).mockClear();

        MockEventSource.instances.at(0)?.emit(
            'guild-feature-settings.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'import_export',
                event: 'guild-feature-settings.changed',
            })
        );

        await waitFor(() => expect(readDashboardStructureSettingsRouteData).toHaveBeenCalledTimes(1));
    });

    it('does not invalidate for unrelated guild live events', async () => {
        renderGuildPage(createGuildRouteData(), 'general');
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
        );
        MockEventSource.instances.at(0)?.emit(
            'guild-feature-settings.changed',
            JSON.stringify({
                guildId: 'guild-2',
                area: 'commands',
                event: 'guild-feature-settings.changed',
            })
        );
        await Promise.resolve();

        expect(readDashboardCommandSettingsRouteData).not.toHaveBeenCalled();
    });

    it('closes live subscriptions while hidden and refetches once when visible again', async () => {
        renderGuildPage(createGuildRouteData(), 'general');
        expect(await screen.findByDisplayValue('?')).toBeTruthy();
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
        );
        const firstEventSource = MockEventSource.instances.at(0);

        documentVisibilityState = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        documentVisibilityState = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));

        expect(firstEventSource?.close).toHaveBeenCalledTimes(1);
        expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2);
        expect(MockEventSource.instances.at(-1)?.url).toBe('/dashboard/guild-1/events?areas=commands');
        await waitFor(() => expect(readDashboardCommandSettingsRouteData).toHaveBeenCalled());
        expect(screen.queryByText('Refreshing live setting...')).toBeNull();
    });

    it('does not overwrite dirty prefix input when another source changes the saved value', async () => {
        vi.mocked(readDashboardCommandSettingsRouteData).mockResolvedValue(createCommandSettingsReadResult('$'));
        const { container } = renderGuildPage(createGuildRouteData(), 'general');
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue<HTMLInputElement>('?');
        await waitFor(() =>
            expect(MockEventSource.instances.at(0)?.url).toBe('/dashboard/guild-1/events?areas=commands')
        );

        fireEvent.change(prefixInput, { target: { value: '?1' } });
        MockEventSource.instances.at(0)?.emit(
            'guild-feature-settings.changed',
            JSON.stringify({
                guildId: 'guild-1',
                area: 'commands',
                event: 'guild-feature-settings.changed',
            })
        );

        await waitFor(() => expect(readDashboardCommandSettingsRouteData).toHaveBeenCalledTimes(1));
        expect(await currentView.findByText('Command prefix changed elsewhere to $.')).toBeTruthy();
        expect(prefixInput.value).toBe('?1');
    });

    it('disables prefix saving when the input has not changed', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'general');
        const currentView = within(container);

        expect(await currentView.findByDisplayValue('?')).toBeTruthy();
        expect(currentView.getByRole('button', { name: 'Save prefix' }).hasAttribute('disabled')).toBe(true);
    });

    it('allows typing in the prefix input without throwing', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'general');
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue<HTMLInputElement>('?');

        fireEvent.change(prefixInput, { target: { value: '?1' } });

        expect(prefixInput.value).toBe('?1');
    });

    it('shows a clear validation error for invalid command prefixes', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'general');
        const currentView = within(container);
        const prefixInput = await currentView.findByDisplayValue('?');

        fireEvent.change(prefixInput, { target: { value: 'abc' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Save prefix' }));

        expect(await currentView.findByText(COMMAND_PREFIX_INVALID_MESSAGE)).toBeTruthy();
    });

    it('shows a clear validation error for malformed embed JSON before posting', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.click(currentView.getByLabelText('Advanced JSON'));
        fireEvent.change(currentView.getByLabelText('Embed JSON'), { target: { value: '{' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        expect(await currentView.findByText('Embed JSON is not valid JSON.')).toBeTruthy();
        expect(postDashboardMessageRouteData).not.toHaveBeenCalled();
    });

    it('posts dashboard messages with content and builder embed payloads', async () => {
        vi.mocked(postDashboardMessageRouteData).mockResolvedValueOnce({
            type: 'sent',
            message: {
                id: 'message-1',
                guildId: 'guild-1',
                channelId: 'channel-2',
            },
        });
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'rel notes', '#release-notes');
        fireEvent.change(currentView.getByLabelText('Message content'), { target: { value: 'hello' } });
        const sidebarColorInput = currentView.getByLabelText<HTMLInputElement>('Sidebar color');

        expect(sidebarColorInput.type).toBe('color');
        expect(currentView.queryByRole('checkbox', { name: 'Include sidebar color' })).toBeNull();

        fireEvent.change(sidebarColorInput, { target: { value: '#ff00aa' } });
        fireEvent.change(currentView.getByLabelText('Author name'), { target: { value: 'NeonFlux' } });
        fireEvent.change(currentView.getByLabelText('Author icon URL'), {
            target: { value: 'https://example.com/author.png' },
        });
        fireEvent.change(currentView.getByLabelText('Author link URL'), {
            target: { value: 'https://example.com/author' },
        });
        fireEvent.change(currentView.getByLabelText('Title'), { target: { value: 'Release notes' } });
        fireEvent.change(currentView.getByLabelText('Title URL'), {
            target: { value: 'https://example.com/releases' },
        });
        fireEvent.change(currentView.getByLabelText('Main body'), {
            target: { value: 'Fluxer update' },
        });
        fireEvent.change(currentView.getByLabelText('Thumbnail URL'), {
            target: { value: 'https://example.com/thumb.png' },
        });
        fireEvent.change(currentView.getByLabelText('Image URL'), {
            target: { value: 'https://example.com/image.png' },
        });
        fireEvent.change(currentView.getByLabelText('Footer text'), { target: { value: 'NeonFlux footer' } });
        fireEvent.change(currentView.getByLabelText('Footer icon URL'), {
            target: { value: 'https://example.com/footer.png' },
        });
        fireEvent.click(currentView.getByLabelText('Timestamp'));
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-2',
                    content: 'hello',
                    embeds: [
                        {
                            color: 16711850,
                            author: {
                                name: 'NeonFlux',
                                icon_url: 'https://example.com/author.png',
                                url: 'https://example.com/author',
                            },
                            title: 'Release notes',
                            url: 'https://example.com/releases',
                            description: 'Fluxer update',
                            thumbnail: {
                                url: 'https://example.com/thumb.png',
                            },
                            image: {
                                url: 'https://example.com/image.png',
                            },
                            footer: {
                                text: 'NeonFlux footer',
                                icon_url: 'https://example.com/footer.png',
                            },
                            timestamp: expect.any(String),
                        },
                    ],
                },
            })
        );
        expect(await currentView.findByText('Message sent to #release-notes.')).toBeTruthy();
    });

    it('updates builder embed color directly from the color picker', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Title'), { target: { value: 'Color test' } });
        fireEvent.change(currentView.getByLabelText('Sidebar color'), { target: { value: '#3366ff' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    embeds: [
                        {
                            color: 3368703,
                            title: 'Color test',
                        },
                    ],
                },
            })
        );
    });

    it('keeps content-only posting working with an empty builder', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Message content'), { target: { value: 'plain text only' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    content: 'plain text only',
                    embeds: [],
                },
            })
        );
    });

    it('omits empty builder embed fields from the outgoing payload', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Title'), { target: { value: 'NeonFlux' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    embeds: [{ title: 'NeonFlux' }],
                },
            })
        );
    });

    it('sends embed-only builder payloads', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.change(currentView.getByLabelText('Main body'), { target: { value: 'Embed-only update' } });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    embeds: [{ description: 'Embed-only update' }],
                },
            })
        );
    });

    it('keeps advanced JSON mode for custom multi-embed payloads', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);

        await selectPostingChannel(currentView, 'gen', '#general');
        fireEvent.click(currentView.getByLabelText('Advanced JSON'));
        fireEvent.change(currentView.getByLabelText('Embed JSON'), {
            target: { value: '[{"title":"One"},{"title":"Two"}]' },
        });
        fireEvent.click(currentView.getByRole('button', { name: 'Send message' }));

        await waitFor(() =>
            expect(postDashboardMessageRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    embeds: [{ title: 'One' }, { title: 'Two' }],
                },
            })
        );
    });

    it('applies saved posting templates without reducing embed payloads', async () => {
        vi.mocked(readDashboardPostingTemplatesRouteData).mockResolvedValueOnce({
            type: 'templates',
            templates: [
                {
                    id: 'template-1',
                    guildId: 'guild-1',
                    name: 'Release update',
                    content: 'Saved content',
                    embeds: [{ title: 'Saved embed' }, { description: 'Second embed' }],
                    updatedAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);
        const templateSelect = await currentView.findByLabelText<HTMLSelectElement>('Saved templates');

        await currentView.findByRole('option', { name: 'Release update' });
        fireEvent.change(templateSelect, { target: { value: 'template-1' } });
        await waitFor(() =>
            expect(currentView.getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(false)
        );
        fireEvent.click(currentView.getByRole('button', { name: 'Apply' }));

        expect(currentView.getByLabelText<HTMLTextAreaElement>('Message content').value).toBe('Saved content');
        expect(currentView.getByLabelText<HTMLTextAreaElement>('Embed JSON').value).toBe(
            JSON.stringify([{ title: 'Saved embed' }, { description: 'Second embed' }], null, 2)
        );
        expect(await currentView.findByText('Template applied: Release update.')).toBeTruthy();
    });

    it('updates the posting preview from message content and builder fields', async () => {
        const { container } = renderGuildPage(createGuildRouteData(), 'messaging');
        const currentView = within(container);
        const preview = within(currentView.getByRole('region', { name: 'Message preview' }));

        expect(preview.getByText('Nothing to preview.')).toBeTruthy();

        fireEvent.change(currentView.getByLabelText('Message content'), { target: { value: 'plain preview' } });
        fireEvent.change(currentView.getByLabelText('Title'), { target: { value: 'Preview title' } });
        fireEvent.change(currentView.getByLabelText('Main body'), { target: { value: 'Preview body' } });
        fireEvent.change(currentView.getByLabelText('Footer text'), { target: { value: 'Preview footer' } });

        expect(preview.getByText('plain preview')).toBeTruthy();
        expect(preview.getByText('Preview title')).toBeTruthy();
        expect(preview.getByText('Preview body')).toBeTruthy();
        expect(preview.getByText('Preview footer')).toBeTruthy();
    });

    it('renders structured audit events and searches within the selected field', async () => {
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    actorUsername: 'neonsy',
                    actorDisplayName: 'Neonsy',
                    targetId: 'message-1',
                    metadata: {
                        channelId: 'channel-1',
                        messageId: 'message-1',
                        contentLength: 5,
                        embedCount: 0,
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T00:00:00.000Z',
                },
                {
                    id: 'event-2',
                    feature: 'settings',
                    action: 'prefix.updated',
                    actorUserId: 'actor-2',
                    targetId: 'prefix',
                    metadata: {
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T01:00:00.000Z',
                },
            ],
        });
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    actorUsername: 'neonsy',
                    targetId: 'message-1',
                    metadata: {
                        channelId: 'channel-1',
                        messageId: 'message-1',
                        contentLength: 5,
                        embedCount: 0,
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    actorUsername: 'neonsy',
                    targetId: 'message-1',
                    metadata: {
                        channelId: 'channel-1',
                        messageId: 'message-1',
                        contentLength: 5,
                        embedCount: 0,
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T00:00:00.000Z',
                },
            ],
        });

        renderGuildPage(createGuildRouteData(), 'audit');

        expect(await screen.findByText('message.sent')).toBeTruthy();
        expect(screen.getByText('prefix.updated')).toBeTruthy();
        expect(screen.getByText('Loaded 2 events.')).toBeTruthy();
        expect(screen.getByText('#general')).toBeTruthy();
        expect(screen.getByText('channel-1')).toBeTruthy();
        expect(screen.getByText('message-1')).toBeTruthy();
        expect(screen.getByText('@neonsy')).toBeTruthy();
        expect(screen.getByText('actor-1')).toBeTruthy();
        expect(screen.getByText('Content length')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Search in'), { target: { value: 'channel' } });
        fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'channel-1' } });

        await waitFor(() =>
            expect(readDashboardAuditEventsRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    limit: 40,
                    search: 'channel-1',
                    searchScope: 'channel',
                    searchOffsetMinutes: expect.any(Number),
                },
            })
        );
        expect(await screen.findByText('message.sent')).toBeTruthy();
        expect(screen.queryByText('prefix.updated')).toBeNull();
        expect(screen.getByText('Loaded 1 matching channel events.')).toBeTruthy();
    });

    it('loads older persisted dashboard audit events from the next cursor', async () => {
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-1',
                    feature: 'posting',
                    action: 'message.sent',
                    actorUserId: 'actor-1',
                    targetId: 'message-1',
                    metadata: {
                        channelId: 'channel-1',
                        messageId: 'message-1',
                        contentLength: 5,
                        embedCount: 0,
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-26T00:00:00.000Z',
                },
            ],
            nextCursor: 'cursor-1',
        });
        vi.mocked(readDashboardAuditEventsRouteData).mockResolvedValueOnce({
            type: 'events',
            auditEvents: [
                {
                    id: 'event-2',
                    feature: 'settings',
                    action: 'prefix.updated',
                    actorUserId: 'actor-2',
                    targetId: 'prefix',
                    metadata: {
                        source: 'dashboard',
                    },
                    createdAt: '2026-06-25T00:00:00.000Z',
                },
            ],
        });

        renderGuildPage(createGuildRouteData(), 'audit');

        expect(await screen.findByText('message.sent')).toBeTruthy();
        await waitFor(() =>
            expect(readDashboardAuditEventsRouteData).toHaveBeenCalledWith({
                data: {
                    guildId: 'guild-1',
                    cursor: 'cursor-1',
                    limit: 40,
                    searchScope: 'all',
                    searchOffsetMinutes: expect.any(Number),
                },
            })
        );
        expect(await screen.findByText('prefix.updated')).toBeTruthy();
    });

    it('renders the single-instance unauthorized state', async () => {
        renderGuildPage({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Configured Community',
        });

        expect(await screen.findByRole('heading', { name: 'Not authorized' })).toBeTruthy();
        expect(screen.getByText('You are not authorized to modify Configured Community.')).toBeTruthy();
    });

    it('renders generic community unavailable errors', async () => {
        renderGuildPage({
            type: 'unavailable',
            status: 404,
            title: 'Community unavailable',
            message: 'This community is not available for this account.',
        });

        expect(await screen.findByRole('heading', { name: 'Community unavailable' })).toBeTruthy();
        expect(screen.getByText('This community is not available for this account.')).toBeTruthy();
    });

    it('does not render session, token, or Fluxer user data', async () => {
        renderGuildPage();

        expect(await screen.findByRole('heading', { name: 'Guild One' })).toBeTruthy();
        expect(document.body.textContent).not.toContain(sessionId);
        expect(document.body.textContent).not.toContain(fluxerUserId);
        expect(document.body.textContent).not.toContain(accessToken);
    });
});

type RouterTestRender = ReturnType<typeof render> & {
    router: {
        state: {
            location: {
                pathname: string;
            };
        };
    };
};

function renderWithRouter(ui: ReactNode): RouterTestRender {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    });
    const rootRoute = createRootRoute();
    const dashboardRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/dashboard',
    });
    const dashboardGuildRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/dashboard/$guildId',
    });
    const dashboardGuildIndexRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: '/',
    });
    const dashboardGuildGeneralRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'general',
    });
    const dashboardGuildMessagingRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'messaging',
    });
    const dashboardGuildInvitesRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'invites',
    });
    const dashboardGuildAccessRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'access',
    });
    const dashboardGuildModerationRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'moderation',
    });
    const dashboardGuildLoggingRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'logging',
    });
    const dashboardGuildCommunityRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'community',
    });
    const dashboardGuildStructureRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'structure',
    });
    const dashboardGuildAuditRoute = createRoute({
        getParentRoute: () => dashboardGuildRoute,
        path: 'audit',
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([
            dashboardRoute.addChildren([
                dashboardGuildRoute.addChildren([
                    dashboardGuildIndexRoute,
                    dashboardGuildGeneralRoute,
                    dashboardGuildMessagingRoute,
                    dashboardGuildInvitesRoute,
                    dashboardGuildAccessRoute,
                    dashboardGuildModerationRoute,
                    dashboardGuildLoggingRoute,
                    dashboardGuildCommunityRoute,
                    dashboardGuildStructureRoute,
                    dashboardGuildAuditRoute,
                ]),
            ]),
        ]),
    });
    const providerProps = { router } as ComponentProps<typeof RouterContextProvider>;

    const view = render(
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RouterContextProvider, providerProps, ui)
        )
    ) as RouterTestRender;
    view.router = router;
    renderedViews.push(view);

    return view;
}

function renderGuildPage(
    routeData: DashboardGuildRouteData = createGuildRouteData(),
    categoryId: DashboardCategoryId = 'overview'
): RouterTestRender {
    return renderWithRouter(
        createElement(
            DashboardGuildPageContent,
            { data: routeData, activeCategoryId: categoryId },
            createDashboardCategoryElement(categoryId)
        )
    );
}

function createDashboardCategoryElement(categoryId: DashboardCategoryId): ReactNode {
    switch (categoryId) {
        case 'overview':
            return createElement(DashboardGuildOverviewCategory);

        case 'general':
            return createElement(DashboardGuildGeneralCategory);

        case 'messaging':
            return createElement(DashboardGuildMessagingCategory);

        case 'invites':
            return createElement(DashboardGuildInviteTrackingCategory);

        case 'access':
            return createElement(DashboardGuildAccessCategory);

        case 'moderation':
            return createElement(DashboardGuildModerationCategory);

        case 'audit':
            return createElement(DashboardGuildAuditCategory);

        case 'logging':
            return createElement(DashboardGuildLoggingCategory);

        case 'community':
            return createElement(DashboardGuildCommunityCategory);

        case 'structure':
            return createElement(DashboardGuildStructureCategory);
    }
}

async function selectPostingChannel(
    currentView: ReturnType<typeof within>,
    search: string,
    channelLabel: string
): Promise<void> {
    const channelInput = currentView.getByLabelText('Channel');

    fireEvent.focus(channelInput);
    fireEvent.change(channelInput, { target: { value: search } });
    fireEvent.click(await currentView.findByRole('button', { name: new RegExp(channelLabel) }));
}

function createGuildData(): Parameters<typeof toDashboardGuildRouteResult>[0] {
    return {
        type: 'guild',
        mode: 'multi',
        guild: {
            id: 'guild-1',
            name: 'Guild One',
            iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
        },
        manageableGuilds: [
            {
                id: 'guild-1',
                name: 'Guild One',
                iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
            },
            {
                id: 'guild-2',
                name: 'Guild Two',
            },
        ],
        botInviteUrl,
        commandSettings: {
            prefix: '?',
            isDefaultPrefix: false,
        },
    };
}

function createGuildRouteData(): Extract<DashboardGuildRouteData, { type: 'guild' }> {
    return {
        type: 'guild',
        mode: 'multi',
        guild: {
            id: 'guild-1',
            name: 'Guild One',
            iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
        },
        manageableGuilds: [
            {
                id: 'guild-1',
                name: 'Guild One',
                iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
            },
            {
                id: 'guild-2',
                name: 'Guild Two',
            },
        ],
        botInviteUrl,
        commandSettings: {
            prefix: '?',
            isDefaultPrefix: false,
        },
    };
}

function createCommandSettingsReadResult(prefix: string) {
    return {
        type: 'settings' as const,
        commandSettings: {
            prefix,
            isDefaultPrefix: prefix === '!',
        },
    };
}

function createCommandAccessReadResult() {
    return {
        type: 'access' as const,
        catalog: {
            categories: [
                {
                    id: 'settings',
                    title: 'Settings',
                },
            ],
            commands: [
                {
                    id: 'settings.prefix',
                    categoryId: 'settings',
                    categoryTitle: 'Settings',
                    commandName: 'prefix',
                    description: 'Change the command prefix. Requires Manage Server or an allowed role/user rule.',
                },
            ],
        },
        roles: [
            {
                id: 'role-a',
                name: 'Moderator',
                position: 20,
            },
        ],
        roleReadStatus: 'available' as const,
        rules: [],
    };
}

function createAutoroleSettingsReadResult() {
    return {
        type: 'settings' as const,
        roleReadStatus: 'available' as const,
        roles: [
            {
                id: 'role-1',
                name: 'Member',
                position: 10,
            },
        ],
        rules: [
            {
                id: 'autorole-rule-1',
                roleId: 'role-1',
                name: 'Member',
                enabled: true,
                updatedAt: '2026-06-26T10:00:00.000Z',
            },
        ],
    };
}

function createReactionRolesSettingsReadResult(
    overrides: {
        options?: ReturnType<typeof createReactionRoleOptionReadResult>[];
    } = {}
) {
    return {
        type: 'settings' as const,
        structureReadStatus: 'available' as const,
        emojiReadStatus: 'available' as const,
        roles: [
            {
                id: 'role-1',
                name: 'Member',
                position: 10,
                color: 0,
            },
            {
                id: 'role-zeta',
                name: 'Zeta',
                position: 9,
                color: 0,
            },
        ],
        channels: [
            {
                id: 'channel-1',
                name: 'roles',
                type: 0,
                position: 1,
            },
        ],
        emojis: [],
        messages: [
            {
                id: 'reaction-role-message-1',
                channelId: 'channel-1',
                channelName: 'roles',
                messageId: 'message-1',
                mode: 'normal' as const,
                source: 'existing' as const,
                messageContent: 'Pick roles',
                messageEmbeds: [],
                generateOverview: false,
                enabled: true,
                updatedAt: '2026-06-26T10:00:00.000Z',
                options: overrides.options ?? [createReactionRoleOptionReadResult()],
            },
        ],
    };
}

function createReactionRoleOptionReadResult(
    overrides: {
        id?: string;
        emojiKey?: string;
        emojiLabel?: string;
        roleId?: string;
        roleName?: string;
        roleColor?: number;
        position?: number;
    } = {}
) {
    return {
        id: overrides.id ?? `reaction-role-option-${String(overrides.position ?? 0)}`,
        emojiKey: overrides.emojiKey ?? 'unicode:check',
        ...(overrides.emojiLabel ? { emojiLabel: overrides.emojiLabel } : {}),
        roleId: overrides.roleId ?? 'role-1',
        roleName: overrides.roleName ?? (overrides.roleId === 'role-zeta' ? 'Zeta' : 'Member'),
        roleColor: overrides.roleColor ?? 0,
        position: overrides.position ?? 0,
    };
}

function createVerificationSettingsReadResult() {
    return {
        type: 'settings' as const,
        structureReadStatus: 'available' as const,
        roles: [
            {
                id: 'role-verified',
                name: 'Verified',
                position: 9,
            },
        ],
        channels: [
            {
                id: 'channel-verify',
                name: 'verify',
                type: 0,
                position: 2,
            },
        ],
        flows: [
            {
                id: 'verification-flow-1',
                channelId: 'channel-verify',
                channelName: 'verify',
                messageId: 'message-verify',
                emojiKey: 'unicode:check',
                verifiedRoleId: 'role-verified',
                verifiedRoleName: 'Verified',
                enabled: true,
                updatedAt: '2026-06-26T10:00:00.000Z',
            },
        ],
    };
}

function createRoleReconciliationSettingsReadResult() {
    return {
        type: 'settings' as const,
        settings: {
            enabled: true,
            restoreAutoroleRoles: true,
            restoreVerificationRoles: true,
            restoreReactionRoles: true,
            cleanupDeletedRoleReferences: true,
            updatedAt: '2026-06-26T10:00:00.000Z',
        },
    };
}

function createXpSettingsReadResult() {
    return {
        type: 'settings' as const,
        settings: {
            enabled: false,
            messageXpMin: 5,
            messageXpMax: 10,
            cooldownSeconds: 60,
            voiceXpPerMinute: 2,
            voiceMinimumMinutes: 5,
            updatedAt: '2026-06-26T10:00:00.000Z',
        },
    };
}

function createVcGeneratorSettingsReadResult() {
    return {
        type: 'settings' as const,
        structureReadStatus: 'available' as const,
        voiceChannels: [
            {
                id: 'voice-source-1',
                name: 'Join to Create',
                type: 2,
                parentId: 'category-1',
                parentName: 'Voice',
                position: 1,
            },
        ],
        textChannels: [
            {
                id: 'panel-channel-1',
                name: 'Voice Panels',
                type: 0,
                parentId: 'category-1',
                parentName: 'Voice',
                position: 2,
            },
        ],
        categories: [
            {
                id: 'category-1',
                name: 'Voice',
                position: 1,
            },
        ],
        rules: [createVcGeneratorRule()],
    };
}

function createVcGeneratorRule() {
    return {
        id: 'vc-rule-1',
        sourceChannelId: 'voice-source-1',
        sourceChannelName: 'Join to Create',
        categoryId: 'category-1',
        categoryName: 'Voice',
        panelChannelId: 'panel-channel-1',
        panelChannelName: 'Voice Panels',
        panelMessageId: 'panel-message-1',
        panelStatus: 'active',
        nameTemplate: '{user} room',
        enabled: true,
        updatedAt: '2026-06-26T10:00:00.000Z',
    };
}

function createTicketsSettingsReadResult() {
    return {
        type: 'settings' as const,
        structureReadStatus: 'available' as const,
        textChannels: [
            {
                id: 'ticket-channel-1',
                name: 'tickets',
                type: 0,
                parentId: 'category-1',
                parentName: 'Community',
                position: 3,
            },
        ],
        categories: [
            {
                id: 'category-1',
                name: 'Community',
                position: 1,
            },
        ],
        roles: [
            {
                id: 'support-role-1',
                name: 'Support',
                position: 5,
                color: 0x38bdf8,
            },
        ],
        panels: [
            {
                id: 'ticket-panel-1',
                channelId: 'ticket-channel-1',
                channelName: 'tickets',
                messageId: 'ticket-message-1',
                title: 'Support tickets',
                enabled: true,
                config: {
                    description: 'React to open a ticket.',
                    openEmoji: '🎫',
                    openEmojiKey: 'unicode:🎫',
                    ticketCategoryId: 'category-1',
                    staffRoleIds: ['support-role-1'],
                    ticketNameTemplate: 'ticket-{number}',
                    maxOpenPerUser: 1,
                    privateTickets: true,
                    syncStatus: 'active' as const,
                },
                updatedAt: '2026-06-26T10:00:00.000Z',
            },
        ],
    };
}

function createSuggestionsSettingsReadResult() {
    return {
        type: 'settings' as const,
        structureReadStatus: 'available' as const,
        channels: [
            {
                id: 'suggestions-channel-1',
                name: 'suggestions',
                type: 0,
                parentId: 'category-1',
                parentName: 'Community',
                position: 3,
            },
        ],
        boards: [
            {
                id: 'suggestion-board-1',
                name: 'ideas',
                channelId: 'suggestions-channel-1',
                channelName: 'suggestions',
                enabled: true,
                updatedAt: '2026-06-26T10:00:00.000Z',
            },
        ],
    };
}

function createProfileBuilderSettingsReadResult() {
    return {
        type: 'settings' as const,
        publicUrlStatus: 'available' as const,
        forms: [
            {
                id: 'form-1',
                name: 'default',
                approvalRequired: true,
                enabled: true,
                publicUrl: 'https://neonflux.example/profile-builder?guildId=guild-1&form=default',
                publicPath: '/profile-builder?guildId=guild-1&form=default',
                fields: [
                    {
                        id: 'field-1',
                        fieldKey: 'display_name',
                        label: 'Display name',
                        fieldType: 'text' as const,
                        required: true,
                        maxLength: 80,
                        position: 0,
                    },
                    {
                        id: 'field-2',
                        fieldKey: 'bio',
                        label: 'Bio',
                        fieldType: 'textarea' as const,
                        required: false,
                        maxLength: 500,
                        position: 1,
                    },
                ],
                updatedAt: '2026-06-26T10:00:00.000Z',
            },
        ],
        submissions: [
            {
                id: 'submission-1',
                formId: 'form-1',
                formName: 'default',
                userId: 'user-1',
                status: 'pending',
                values: {
                    display_name: 'Neon',
                    bio: 'Flux enthusiast',
                },
                submittedAt: '2026-06-26T10:00:00.000Z',
            },
        ],
    };
}

function createGiveawaysSettingsReadResult() {
    return {
        type: 'settings' as const,
        structureReadStatus: 'available' as const,
        channels: [
            {
                id: 'giveaway-channel-1',
                name: 'giveaways',
                type: 0,
                parentId: 'category-1',
                parentName: 'Community',
                position: 4,
            },
        ],
        giveaways: [
            {
                id: 'giveaway-1',
                channelId: 'giveaway-channel-1',
                channelName: 'giveaways',
                messageId: 'giveaway-message-1',
                title: 'Launch giveaway',
                prize: 'Nitro',
                description: 'React to enter.',
                entryEmoji: '🎉',
                winnerCount: 1,
                status: 'active',
                entryCount: 3,
                winners: [],
                syncStatus: 'active' as const,
                endsAt: '2026-06-27T10:30:00.000Z',
                createdAt: '2026-06-26T10:00:00.000Z',
            },
            {
                id: 'giveaway-2',
                channelId: 'giveaway-channel-1',
                channelName: 'giveaways',
                messageId: 'giveaway-message-2',
                title: 'Closed giveaway',
                prize: 'Sticker pack',
                entryEmoji: '🎁',
                winnerCount: 1,
                status: 'closed',
                entryCount: 5,
                winners: [
                    {
                        userId: 'user-1',
                        drawNumber: 1,
                        selectedAt: '2026-06-26T10:05:00.000Z',
                    },
                ],
                syncStatus: 'active' as const,
                closedAt: '2026-06-26T10:05:00.000Z',
                createdAt: '2026-06-26T10:00:00.000Z',
            },
            {
                id: 'giveaway-3',
                channelId: 'giveaway-channel-1',
                channelName: 'giveaways',
                messageId: 'giveaway-message-3',
                title: 'Cancelled giveaway',
                prize: 'Role color',
                entryEmoji: '⭐',
                winnerCount: 1,
                status: 'cancelled',
                entryCount: 0,
                winners: [],
                syncStatus: 'stale' as const,
                createdAt: '2026-06-26T10:00:00.000Z',
            },
        ],
    };
}

function createLoggingSettingsReadResult() {
    return {
        type: 'settings' as const,
        eventGroups: [
            {
                id: 'messages' as const,
                label: 'Messages',
                description: 'Message edits and deletions.',
            },
        ],
        destinations: [],
    };
}

function createStructureSettingsReadResult() {
    return {
        type: 'settings' as const,
        exports: [createStructureExportSummary()],
        importRuns: [createStructureImportRun()],
        observedState: {
            observedChangeCount: 0,
        },
    };
}

function createStructureExportSummary() {
    return {
        id: 'structure-export-1',
        source: 'dashboard',
        createdByUserId: fluxerUserId,
        createdAt: '2026-06-26T10:00:00.000Z',
        roleCount: 2,
        categoryCount: 1,
        channelCount: 3,
    };
}

function createStructureImportRun() {
    return {
        id: 'structure-import-run-1',
        status: 'dry_run_complete',
        createdByUserId: fluxerUserId,
        createdAt: '2026-06-26T10:05:00.000Z',
        updatedAt: '2026-06-26T10:05:01.000Z',
        summary: {
            creates: 1,
            updates: 1,
            deletes: 0,
            roles: 1,
            categories: 0,
            channels: 1,
        },
        actions: [
            {
                id: 'structure-action-1',
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                label: 'general',
                details: {
                    label: 'general',
                },
            },
        ],
    };
}

function createDashboardOverview(overrides: Partial<DashboardOverviewTestData> = {}): DashboardOverviewTestData {
    return {
        memberFlow: {
            totalJoins: 0,
            totalLeaves: 0,
            netGrowth: 0,
            graph: [{ date: '2026-06-26', joins: 0, leaves: 0, netGrowth: 0 }],
        },
        invites: {
            activeInviteCount: 0,
            totalInviteUses: 0,
            attribution: {
                attributed: 0,
                baselineMissing: 0,
                ambiguous: 0,
                unavailable: 0,
                notApplicable: 0,
            },
            topInviters: [],
        },
        messages: {
            totalMessages: 0,
            graph: [{ date: '2026-06-26', messageCount: 0 }],
            topChannels: [],
        },
        dataHealth: {
            hasMemberFlow: false,
            hasInviteSnapshots: false,
            hasMessageActivity: false,
        },
        ...overrides,
    };
}

type DashboardOverviewTestData = Extract<
    Awaited<ReturnType<typeof readDashboardGuildOverviewRouteData>>,
    { type: 'overview' }
>['overview'];

function getRedirectOptions(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object' || !('options' in error)) {
        throw new Error('Expected TanStack Router redirect options.');
    }

    return (error as { options: Record<string, unknown> }).options;
}

class MockEventSource {
    static instances: MockEventSource[] = [];

    readonly url: string;
    readonly close = vi.fn();
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    private readonly listeners = new Map<string, Set<EventListener>>();

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: EventListener): void {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>();

        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: EventListener): void {
        this.listeners.get(type)?.delete(listener);
    }

    emit(type: string, data: string): void {
        const event = new MessageEvent(type, { data });

        this.onmessage?.(event);

        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
    }
}
