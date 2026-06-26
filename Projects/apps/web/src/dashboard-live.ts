export const dashboardLiveAreas = ['commands', 'audit'] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];

export type DashboardLiveEvent =
    | {
          guildId: string;
          area: 'commands';
          event: 'guild-feature-settings.changed';
      }
    | {
          guildId: string;
          area: 'audit';
          event: 'dashboard-audit-events.changed';
      };

export function isDashboardLiveArea(value: unknown): value is DashboardLiveArea {
    return typeof value === 'string' && (dashboardLiveAreas as readonly string[]).includes(value);
}

export function parseDashboardLiveEventPayload(payload: string): DashboardLiveEvent | undefined {
    let parsedPayload: unknown;

    try {
        parsedPayload = JSON.parse(payload);
    } catch {
        return undefined;
    }

    if (!parsedPayload || typeof parsedPayload !== 'object') {
        return undefined;
    }

    const eventPayload = parsedPayload as Record<string, unknown>;
    const guildId = typeof eventPayload.guildId === 'string' ? eventPayload.guildId.trim() : '';

    if (!guildId || !isDashboardLiveArea(eventPayload.area)) {
        return undefined;
    }

    if (eventPayload.area === 'commands' && eventPayload.event === 'guild-feature-settings.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    if (eventPayload.area === 'audit' && eventPayload.event === 'dashboard-audit-events.changed') {
        return {
            guildId,
            area: eventPayload.area,
            event: eventPayload.event,
        };
    }

    return undefined;
}
