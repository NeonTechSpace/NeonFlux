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

    it('rejects malformed and unknown dashboard event payloads', () => {
        expect(parseDashboardLiveEventPayload('{')).toBeUndefined();
        expect(parseDashboardLiveEventPayload(JSON.stringify({}))).toBeUndefined();
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: 'guild-1',
                    area: 'moderation',
                    event: 'guild-feature-settings.changed',
                })
            )
        ).toBeUndefined();
        expect(
            parseDashboardLiveEventPayload(
                JSON.stringify({
                    guildId: 'guild-1',
                    area: 'commands',
                    event: 'token.changed',
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
            valid: false,
        });
    });

    it('fans out only matching guild and area events', () => {
        const fanout = createDashboardLiveEventFanout();
        const sentEvents: unknown[] = [];

        fanout.subscribe({
            guildId: 'guild-1',
            areas: new Set(['commands']),
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

        expect(sentEvents).toStrictEqual([
            {
                guildId: 'guild-1',
                area: 'commands',
                event: 'guild-feature-settings.changed',
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
