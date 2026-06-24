import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { parseDashboardLiveEventPayload } from '../dashboard-live.js';
import type { DashboardLiveArea } from '../dashboard-live.js';
import { getDashboardCommandSettingsQueryKey } from '../dashboard-query-keys.js';

export function useDashboardLiveInvalidation({
    guildId,
    areas,
}: {
    guildId: string;
    areas: readonly DashboardLiveArea[];
}) {
    const queryClient = useQueryClient();
    const areaKey = areas.join(',');

    useEffect(() => {
        if (typeof window === 'undefined' || areas.length === 0) {
            return undefined;
        }

        let eventSource: EventSource | undefined;
        const visibleAreas = new Set(areas);

        function invalidateArea(area: DashboardLiveArea): void {
            const queryKeysByArea = {
                commands: getDashboardCommandSettingsQueryKey(guildId),
            } satisfies Record<DashboardLiveArea, ReturnType<typeof getDashboardCommandSettingsQueryKey>>;

            void queryClient.invalidateQueries({
                queryKey: queryKeysByArea[area],
            });
        }

        function invalidateVisibleAreas(): void {
            for (const area of visibleAreas) {
                invalidateArea(area);
            }
        }

        function connect(): void {
            if (eventSource || document.visibilityState !== 'visible') {
                return;
            }

            const query = new URLSearchParams({
                areas: [...visibleAreas].join(','),
            });

            eventSource = new EventSource(`/dashboard/${encodeURIComponent(guildId)}/events?${query.toString()}`);
            eventSource.onmessage = handleLiveMessage;
        }

        function disconnect(): void {
            if (!eventSource) {
                return;
            }

            eventSource.onmessage = null;
            eventSource.close();
            eventSource = undefined;
        }

        function handleLiveMessage(message: MessageEvent<string>): void {
            const event = parseDashboardLiveEventPayload(message.data);

            if (!event || event.guildId !== guildId || !visibleAreas.has(event.area)) {
                return;
            }

            invalidateArea(event.area);
        }

        function handleVisibilityChange(): void {
            if (document.visibilityState === 'visible') {
                invalidateVisibleAreas();
                connect();
                return;
            }

            disconnect();
        }

        connect();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            disconnect();
        };
    }, [areaKey, areas, guildId, queryClient]);
}
