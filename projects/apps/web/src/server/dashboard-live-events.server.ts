import '@tanstack/react-start/server-only';

import { dashboardLiveAreas } from '../dashboard-live.js';
import type { DashboardLiveArea } from '../dashboard-live.js';

export async function handleDashboardLiveEventsRequest(request: Request, _guildId: string): Promise<Response> {
    const areasResult = readDashboardLiveAreas(request);

    if (!areasResult.valid) {
        return new Response('Invalid dashboard event areas.', { status: 400 });
    }

    return new Response('Dashboard live events use Convex subscriptions.', { status: 410 });
}

export function readDashboardLiveAreas(request: Request):
    | {
          valid: true;
          areas: DashboardLiveArea[];
      }
    | { valid: false } {
    const areasParameter = new URL(request.url).searchParams.get('areas');
    const requestedAreas =
        areasParameter
            ?.split(',')
            .map((area) => area.trim())
            .filter((area) => area.length > 0) ?? [];

    if (requestedAreas.length === 0) {
        return { valid: false };
    }

    const areas = new Set<DashboardLiveArea>();

    for (const requestedArea of requestedAreas) {
        if (!isSupportedDashboardLiveArea(requestedArea)) {
            return { valid: false };
        }

        areas.add(requestedArea);
    }

    return { valid: true, areas: [...areas] };
}

function isSupportedDashboardLiveArea(area: string): area is DashboardLiveArea {
    return (dashboardLiveAreas as readonly string[]).includes(area);
}
