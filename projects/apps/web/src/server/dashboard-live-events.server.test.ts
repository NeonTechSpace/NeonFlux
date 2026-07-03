import { describe, expect, it } from 'vitest';

import { handleDashboardLiveEventsRequest, readDashboardLiveAreas } from './dashboard-live-events.server.js';

describe('dashboard live events compatibility route', () => {
    it('rejects requests without dashboard areas', () => {
        expect(readDashboardLiveAreas(new Request('http://localhost/dashboard/guild-1/events'))).toStrictEqual({
            valid: false,
        });
    });

    it('rejects unsupported dashboard areas', () => {
        expect(
            readDashboardLiveAreas(new Request('http://localhost/dashboard/guild-1/events?areas=commands,unknown'))
        ).toStrictEqual({
            valid: false,
        });
    });

    it('deduplicates supported dashboard areas', () => {
        expect(
            readDashboardLiveAreas(new Request('http://localhost/dashboard/guild-1/events?areas=commands,commands,audit'))
        ).toStrictEqual({
            areas: ['commands', 'audit'],
            valid: true,
        });
    });

    it('returns gone because dashboard live updates use Convex subscriptions', async () => {
        const response = await handleDashboardLiveEventsRequest(
            new Request('http://localhost/dashboard/guild-1/events?areas=commands'),
            'guild-1'
        );

        await expect(response.text()).resolves.toBe('Dashboard live events use Convex subscriptions.');
        expect(response.status).toBe(410);
    });
});
