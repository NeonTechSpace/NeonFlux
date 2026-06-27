import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { parseDashboardLiveEventPayload } from '../dashboard-live.js';
import type { DashboardLiveArea } from '../dashboard-live.js';
import {
    getDashboardAuditEventsQueryKey,
    getDashboardAutomodSettingsQueryKey,
    getDashboardAutoroleSettingsQueryKey,
    getDashboardCommandAccessQueryKey,
    getDashboardCommandSettingsQueryKey,
    getDashboardGiveawaysSettingsQueryKey,
    getDashboardLoggingSettingsQueryKey,
    getDashboardModerationCasesQueryKey,
    getDashboardModerationPolicyQueryKey,
    getDashboardOverviewQueryKey,
    getDashboardPostingTemplatesQueryKey,
    getDashboardProfileBuilderSettingsQueryKey,
    getDashboardReactionRolesSettingsQueryKey,
    getDashboardRoleReconciliationSettingsQueryKey,
    getDashboardStructureSettingsQueryKey,
    getDashboardSuggestionsSettingsQueryKey,
    getDashboardTicketsSettingsQueryKey,
    getDashboardVcGeneratorSettingsQueryKey,
    getDashboardVerificationSettingsQueryKey,
    getDashboardXpSettingsQueryKey,
} from '../dashboard-query-keys.js';

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
            switch (area) {
                case 'overview':
                case 'invites':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardOverviewQueryKey(guildId),
                    });
                    return;

                case 'commands':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardCommandSettingsQueryKey(guildId),
                    });
                    return;

                case 'access':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardCommandAccessQueryKey(guildId),
                    });
                    return;

                case 'autorole':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardAutoroleSettingsQueryKey(guildId),
                    });
                    return;

                case 'moderation':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardModerationPolicyQueryKey(guildId),
                    });
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardModerationCasesQueryKey(guildId),
                    });
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardAutomodSettingsQueryKey(guildId),
                    });
                    return;

                case 'logging':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardLoggingSettingsQueryKey(guildId),
                    });
                    return;

                case 'reaction_roles':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardReactionRolesSettingsQueryKey(guildId),
                    });
                    return;

                case 'role_reconciliation':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardRoleReconciliationSettingsQueryKey(guildId),
                    });
                    return;

                case 'verification':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardVerificationSettingsQueryKey(guildId),
                    });
                    return;

                case 'xp':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardXpSettingsQueryKey(guildId),
                    });
                    return;

                case 'vc_generator':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardVcGeneratorSettingsQueryKey(guildId),
                    });
                    return;

                case 'posting':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardPostingTemplatesQueryKey(guildId),
                    });
                    return;

                case 'tickets':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardTicketsSettingsQueryKey(guildId),
                    });
                    return;

                case 'suggestions':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardSuggestionsSettingsQueryKey(guildId),
                    });
                    return;

                case 'profile_builder':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardProfileBuilderSettingsQueryKey(guildId),
                    });
                    return;

                case 'giveaways':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardGiveawaysSettingsQueryKey(guildId),
                    });
                    return;

                case 'import_export':
                case 'structure':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardStructureSettingsQueryKey(guildId),
                    });
                    return;

                case 'audit':
                    void queryClient.invalidateQueries({
                        queryKey: getDashboardAuditEventsQueryKey(guildId),
                    });
                    return;
            }
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
