export const dashboardLiveAreas = ['commands'] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];

export type DashboardLiveEvent = {
    guildId: string;
    area: DashboardLiveArea;
    event: 'guild-feature-settings.changed';
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

    if (
        !guildId ||
        !isDashboardLiveArea(eventPayload.area) ||
        eventPayload.event !== 'guild-feature-settings.changed'
    ) {
        return undefined;
    }

    return {
        guildId,
        area: eventPayload.area,
        event: eventPayload.event,
    };
}
