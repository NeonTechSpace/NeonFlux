import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { createLogger } from '@neonflux/core';
import { Client } from 'pg';
import type { Notification } from 'pg';

import { dashboardLiveAreas, parseDashboardLiveEventPayload } from '../dashboard-live.js';
import type { DashboardLiveArea, DashboardLiveEvent } from '../dashboard-live.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

export type DashboardLiveEventSubscriber = {
    guildId: string;
    areas: ReadonlySet<DashboardLiveArea>;
    send: (event: DashboardLiveEvent) => void;
};

export type DashboardLiveEventFanout = ReturnType<typeof createDashboardLiveEventFanout>;

const dashboardEventsChannel = 'neonflux_dashboard_events';
const sseConnectedComment = ': connected\n\n';
const sseContentType = 'text/event-stream';
const retryDelayMs = 1_000;

export function createDashboardLiveEventFanout(onFirstSubscriber?: () => void) {
    const subscribers = new Map<number, DashboardLiveEventSubscriber>();
    let nextSubscriberId = 0;

    return {
        getSubscriberCount() {
            return subscribers.size;
        },

        publish(event: DashboardLiveEvent) {
            for (const subscriber of subscribers.values()) {
                if (subscriber.guildId === event.guildId && subscriber.areas.has(event.area)) {
                    subscriber.send(event);
                }
            }
        },

        subscribe(subscriber: DashboardLiveEventSubscriber) {
            const subscriberId = nextSubscriberId;
            const shouldStartListener = subscribers.size === 0;
            nextSubscriberId += 1;
            subscribers.set(subscriberId, subscriber);

            if (shouldStartListener) {
                onFirstSubscriber?.();
            }

            return () => {
                subscribers.delete(subscriberId);
            };
        },
    };
}

const dashboardLiveEventFanout = createDashboardLiveEventFanout(() => {
    ensureDashboardLivePostgresListener();
});

let postgresListenerClient: Client | undefined;
let postgresListenerStart: Promise<void> | undefined;
let postgresListenerRetry: ReturnType<typeof setTimeout> | undefined;

export async function handleDashboardLiveEventsRequest(request: Request, guildId: string): Promise<Response> {
    const areasResult = readDashboardLiveAreas(request);

    if (!areasResult.valid) {
        return new Response('Invalid dashboard event areas.', { status: 400 });
    }

    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    switch (guildPageData.type) {
        case 'guild':
            return createDashboardLiveEventsResponse(dashboardLiveEventFanout, {
                guildId: guildPageData.guild.id,
                areas: areasResult.areas,
                signal: request.signal,
            });

        case 'auth-required':
            return new Response('Authentication required.', { status: 401 });

        case 'not-found':
        case 'single-unauthorized':
            return new Response('Community unavailable.', { status: 404 });

        case 'deployment-config-not-found':
            return new Response('Dashboard unavailable.', { status: 503 });

        case 'database-error':
            return new Response('Dashboard unavailable.', { status: 500 });

        case 'guild-lookup-failed':
            return new Response('Dashboard unavailable.', { status: 502 });
    }
}

export function createDashboardLiveEventsResponse(
    fanout: DashboardLiveEventFanout,
    input: {
        guildId: string;
        areas: readonly DashboardLiveArea[];
        signal?: AbortSignal;
    }
): Response {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            let isClosed = false;

            function close() {
                if (isClosed) {
                    return;
                }

                isClosed = true;
                unsubscribe?.();

                try {
                    controller.close();
                } catch {
                    // The stream can already be closed by the runtime when the client disconnects.
                }
            }

            controller.enqueue(encoder.encode(sseConnectedComment));
            unsubscribe = fanout.subscribe({
                guildId: input.guildId,
                areas: new Set(input.areas),
                send(event) {
                    if (isClosed) {
                        return;
                    }

                    controller.enqueue(encoder.encode(formatSseEvent(event)));
                },
            });
            input.signal?.addEventListener('abort', close, { once: true });
        },
        cancel() {
            unsubscribe?.();
        },
    });

    return new Response(stream, {
        headers: {
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'Content-Type': sseContentType,
        },
    });
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

function ensureDashboardLivePostgresListener(): void {
    if (postgresListenerClient || postgresListenerStart) {
        return;
    }

    postgresListenerStart = startDashboardLivePostgresListener()
        .catch((error: unknown) => {
            logDashboardLiveWarning('dashboard.live_listener_start_failed', {
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorMessage: error instanceof Error ? error.message : 'Unknown dashboard live listener error.',
            });
            scheduleDashboardLivePostgresListenerRetry();
        })
        .finally(() => {
            postgresListenerStart = undefined;
        });
}

async function startDashboardLivePostgresListener(): Promise<void> {
    const config = loadWebConfig();
    const client = new Client({ connectionString: config.databaseUrl });

    client.on('notification', handlePostgresNotification);
    client.on('error', (error: Error) => {
        logDashboardLiveWarning('dashboard.live_listener_error', {
            errorName: error.name,
            errorMessage: error.message,
        });
        clearPostgresListenerClient(client);
        scheduleDashboardLivePostgresListenerRetry();
    });
    client.on('end', () => {
        clearPostgresListenerClient(client);
        scheduleDashboardLivePostgresListenerRetry();
    });

    await client.connect();
    await client.query(`LISTEN ${dashboardEventsChannel}`);
    postgresListenerClient = client;
}

function handlePostgresNotification(notification: Notification): void {
    if (notification.channel !== dashboardEventsChannel || !notification.payload) {
        return;
    }

    const event = parseDashboardLiveEventPayload(notification.payload);

    if (!event) {
        logDashboardLiveWarning('dashboard.live_event_ignored', {
            reason: 'invalid-payload',
        });
        return;
    }

    dashboardLiveEventFanout.publish(event);
}

function clearPostgresListenerClient(client: Client): void {
    if (postgresListenerClient !== client) {
        return;
    }

    postgresListenerClient = undefined;
}

function scheduleDashboardLivePostgresListenerRetry(): void {
    if (postgresListenerRetry || dashboardLiveEventFanout.getSubscriberCount() === 0) {
        return;
    }

    postgresListenerRetry = setTimeout(() => {
        postgresListenerRetry = undefined;
        ensureDashboardLivePostgresListener();
    }, retryDelayMs);
}

function formatSseEvent(event: DashboardLiveEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
}

function isSupportedDashboardLiveArea(area: string): area is DashboardLiveArea {
    return (dashboardLiveAreas as readonly string[]).includes(area);
}

function logDashboardLiveWarning(event: string, context: Record<string, unknown>): void {
    const config = loadWebConfig();
    createLogger(config).warn(event, context);
}
