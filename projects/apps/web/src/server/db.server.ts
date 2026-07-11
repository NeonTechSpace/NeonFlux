import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import type { RuntimeDbClient } from '@neonflux/db';
import { createRuntimeDb } from '@neonflux/db';

let webDbClient: RuntimeDbClient | undefined;
let webDbStart: Promise<RuntimeDbClient> | undefined;
let webDbGeneration = 0;

export async function getWebDb(): Promise<RuntimeDbClient> {
    if (webDbClient) {
        return webDbClient;
    }

    if (webDbStart) {
        return webDbStart;
    }

    const config = loadWebConfig();
    const generation = webDbGeneration;

    const start = createRuntimeDb(config, { serviceName: 'web' });
    const trackedStart = start.then(
        async (client) => {
            if (generation !== webDbGeneration || webDbStart !== trackedStart) {
                await client.close();
                throw new Error('Web database startup was cancelled.');
            }

            webDbClient = client;
            if (webDbStart === trackedStart) webDbStart = undefined;

            return client;
        },
        (error: unknown) => {
            if (webDbStart === trackedStart) webDbStart = undefined;
            throw error;
        }
    );
    webDbStart = trackedStart;

    return webDbStart;
}

export async function closeWebDb(): Promise<void> {
    const client = webDbClient;

    webDbGeneration += 1;
    webDbClient = undefined;
    webDbStart = undefined;

    if (client) {
        await client.close();
    }
}
