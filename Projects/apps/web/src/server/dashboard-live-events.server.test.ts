import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseDashboardLiveEventPayload } from '../dashboard-live.js';
import {
    createDashboardLiveEventFanout,
    createDashboardLiveEventsResponse,
    handleDashboardLiveEventsRequest,
    readDashboardLiveAreas,
} from './dashboard-live-events.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

vi.mock('./dashboard-guild-page.server.js', () => ({
    loadDashboardGuildPageData: vi.fn(),
}));

describe('dashboard live events', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildPageData).mockResolvedValue({
            type: 'auth-required',
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('parses valid command invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'commands',
                    event: 'guild-feature-settings.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'commands',
            event: 'guild-feature-settings.changed',
        });
    });

    it('parses valid overview invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'overview',
                    event: 'overview.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'overview',
            event: 'overview.changed',
        });
    });

    it('parses valid access invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'access',
                    event: 'access-rules.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'access',
            event: 'access-rules.changed',
        });
    });

    it('parses valid autorole invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'autorole',
                    event: 'autorole-rules.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'autorole',
            event: 'autorole-rules.changed',
        });
    });

    it('parses valid moderation invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'moderation',
                    event: 'guild-feature-settings.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'moderation',
            event: 'guild-feature-settings.changed',
        });
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'moderation',
                    event: 'moderation-cases.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'moderation',
            event: 'moderation-cases.changed',
        });
    });

    it('parses valid audit invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'audit',
                    event: 'dashboard-audit-events.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'audit',
            event: 'dashboard-audit-events.changed',
        });
    });

    it('parses valid logging invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'logging',
                    event: 'logging-destinations.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'logging',
            event: 'logging-destinations.changed',
        });
    });

    it('parses valid reaction-role invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'reaction_roles',
                    event: 'reaction-roles.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'reaction_roles',
            event: 'reaction-roles.changed',
        });
    });

    it('parses valid role reconciliation invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'role_reconciliation',
                    event: 'guild-feature-settings.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'role_reconciliation',
            event: 'guild-feature-settings.changed',
        });
    });

    it('parses valid verification invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'verification',
                    event: 'verification-flows.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'verification',
            event: 'verification-flows.changed',
        });
    });

    it('parses valid XP invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'xp',
                    event: 'xp-settings.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'xp',
            event: 'xp-settings.changed',
        });
    });

    it('parses valid VC generator invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'vc_generator',
                    event: 'vc-generator.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'vc_generator',
            event: 'vc-generator.changed',
        });
    });

    it('parses valid posting invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'posting',
                    event: 'posting-templates.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'posting',
            event: 'posting-templates.changed',
        });
    });

    it('parses valid tickets invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'tickets',
                    event: 'tickets.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'tickets',
            event: 'tickets.changed',
        });
    });

    it('parses valid suggestions invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'suggestions',
                    event: 'suggestions.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'suggestions',
            event: 'suggestions.changed',
        });
    });

    it('parses valid profile builder invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'profile_builder',
                    event: 'profile-builder.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'profile_builder',
            event: 'profile-builder.changed',
        });
    });

    it('parses valid giveaway invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'giveaways',
                    event: 'giveaways.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'giveaways',
            event: 'giveaways.changed',
        });
    });

    it('parses valid invite and structure invalidation payloads', () => {
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'invites',
                    event: 'invites.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'invites',
            event: 'invites.changed',
        });
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'import_export',
                    event: 'guild-feature-settings.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'import_export',
            event: 'guild-feature-settings.changed',
        });
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: ' guild-1 ',
                    area: 'structure',
                    event: 'structure.changed',
                })
            )
        ).toStrictEqual({
            guildId: 'guild-1',
            area: 'structure',
            event: 'structure.changed',
        });
    });

    it('rejects malformed and unknown dashboard event payloads', () => {
        expect(parseDashboardLiveEventPayload('{')).toBeUndefined();
        expect(parseDashboardLiveEventPayload(JSON.stringify({}))).toBeUndefined();
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: 'guild-1',
                    area: 'commands',
                    event: 'token.changed',
                })
            )
        ).toBeUndefined();
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: 'guild-1',
                    area: 'audit',
                    event: 'guild-feature-settings.changed',
                })
            )
        ).toBeUndefined();
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: 'guild-1',
                    area: 'commands',
                    event: 'moderation-cases.changed',
                })
            )
        ).toBeUndefined();
    });

    it('reads requested live areas from the request query', () => {
        expect(
            readDashboardLiveAreas(new Request('http://localhost/dashboard/guild-1/events?areas=commands'))
        ).toStrictEqual({
            valid: true,
            areas: ['commands'],
        });
        expect(
            readDashboardLiveAreas(
                new Request(
                    'http://localhost/dashboard/guild-1/events?areas=commands,access,autorole,moderation,logging,reaction_roles,role_reconciliation,verification,audit'
                )
            )
        ).toStrictEqual({
            valid: true,
            areas: [
                'commands',
                'access',
                'autorole',
                'moderation',
                'logging',
                'reaction_roles',
                'role_reconciliation',
                'verification',
                'audit',
            ],
        });
        expect(
            readDashboardLiveAreas(
                new Request(
                    'http://localhost/dashboard/guild-1/events?areas=commands,access,autorole,moderation,logging,reaction_roles,role_reconciliation,verification,xp,audit'
                )
            )
        ).toStrictEqual({
            valid: true,
            areas: [
                'commands',
                'access',
                'autorole',
                'moderation',
                'logging',
                'reaction_roles',
                'role_reconciliation',
                'verification',
                'xp',
                'audit',
            ],
        });
        expect(
            readDashboardLiveAreas(
                new Request(
                    'http://localhost/dashboard/guild-1/events?areas=overview,commands,access,autorole,moderation,logging,reaction_roles,role_reconciliation,verification,xp,vc_generator,posting,tickets,suggestions,profile_builder,giveaways,invites,import_export,structure,audit'
                )
            )
        ).toStrictEqual({
            valid: true,
            areas: [
                'overview',
                'commands',
                'access',
                'autorole',
                'moderation',
                'logging',
                'reaction_roles',
                'role_reconciliation',
                'verification',
                'xp',
                'vc_generator',
                'posting',
                'tickets',
                'suggestions',
                'profile_builder',
                'giveaways',
                'invites',
                'import_export',
                'structure',
                'audit',
            ],
        });
        expect(
            readDashboardLiveAreas(new Request('http://localhost/dashboard/guild-1/events?areas=commands,commands'))
        ).toStrictEqual({
            valid: true,
            areas: ['commands'],
        });
        expect(readDashboardLiveAreas(new Request('http://localhost/dashboard/guild-1/events'))).toStrictEqual({
            valid: false,
        });
        expect(
            readDashboardLiveAreas(new Request('http://localhost/dashboard/guild-1/events?areas=moderation'))
        ).toStrictEqual({
            valid: true,
            areas: ['moderation'],
        });
    });

    it('fans out only matching guild and area events', () => {
        const fanout = createDashboardLiveEventFanout();
        const sentEvents: unknown[] = [];

        fanout.subscribe({
            guildId: 'guild-1',
            areas: new Set(['commands', 'audit']),
            send: (event) => sentEvents.push(event),
        });
        fanout.publish({
            guildId: 'guild-2',
            area: 'commands',
            event: 'guild-feature-settings.changed',
        });
        fanout.publish({
            guildId: 'guild-1',
            area: 'commands',
            event: 'guild-feature-settings.changed',
        });
        fanout.publish({
            guildId: 'guild-1',
            area: 'audit',
            event: 'dashboard-audit-events.changed',
        });

        expect(sentEvents).toStrictEqual([
            {
                guildId: 'guild-1',
                area: 'commands',
                event: 'guild-feature-settings.changed',
            },
            {
                guildId: 'guild-1',
                area: 'audit',
                event: 'dashboard-audit-events.changed',
            },
        ]);
    });

    it('starts the listener callback only when the first subscriber is added', () => {
        const onFirstSubscriber = vi.fn();
        const fanout = createDashboardLiveEventFanout(onFirstSubscriber);
        const firstUnsubscribe = fanout.subscribe({
            guildId: 'guild-1',
            areas: new Set(['commands']),
            send: vi.fn(),
        });

        fanout.subscribe({
            guildId: 'guild-1',
            areas: new Set(['commands']),
            send: vi.fn(),
        });

        expect(onFirstSubscriber).toHaveBeenCalledTimes(1);
        firstUnsubscribe();
        expect(fanout.getSubscriberCount()).toBe(1);
    });

    it('rejects unauthenticated and inaccessible SSE requests before streaming', async () => {
        const request = new Request('http://localhost/dashboard/guild-1/events?areas=commands');

        await expect(handleDashboardLiveEventsRequest(request, 'guild-1')).resolves.toMatchObject({
            status: 401,
        });

        vi.mocked(loadDashboardGuildPageData).mockResolvedValueOnce({ type: 'not-found' });
        await expect(handleDashboardLiveEventsRequest(request, 'guild-1')).resolves.toMatchObject({
            status: 404,
        });
    });

    it('sets SSE headers, streams matching events, and closes on abort', async () => {
        const fanout = createDashboardLiveEventFanout();
        const abortController = new AbortController();
        const response = createDashboardLiveEventsResponse(fanout, {
            guildId: 'guild-1',
            areas: ['commands'],
            signal: abortController.signal,
        });
        const reader = response.body?.getReader();

        expect(response.headers.get('Content-Type')).toBe('text/event-stream');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(reader).toBeDefined();

        const connectedChunk = await reader?.read();
        expect(decodeChunk(connectedChunk?.value)).toContain(': connected');

        const eventChunk = reader?.read();
        fanout.publish({
            guildId: 'guild-1',
            area: 'commands',
            event: 'guild-feature-settings.changed',
        });

        expect(decodeChunk((await eventChunk)?.value)).toContain('data:');
        expect(decodeChunk((await eventChunk)?.value)).toContain('guild-feature-settings.changed');

        abortController.abort();
        await expect(reader?.read()).resolves.toMatchObject({ done: true });
    });
});

function decodeChunk(chunk: Uint8Array | undefined): string {
    return new TextDecoder().decode(chunk);
}
