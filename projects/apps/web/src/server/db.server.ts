import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import type { RuntimeDbClient } from '@neonflux/db';
import { createRuntimeDb } from '@neonflux/db';

let webDbClient: RuntimeDbClient | undefined;
let webDbStart: Promise<RuntimeDbClient> | undefined;

export async function getWebDb(): Promise<RuntimeDbClient> {
    if (webDbClient) {
        return webDbClient;
    }

    if (webDbStart) {
        return webDbStart;
    }

    const config = loadWebConfig();

    webDbStart = createRuntimeDb(config, { serviceName: 'web' }).then((client) => {
        webDbClient = client;
        webDbStart = undefined;

        return client;
    });

    return webDbStart;
}

export async function closeWebDb(): Promise<void> {
    const client = webDbClient;

    webDbClient = undefined;
    webDbStart = undefined;

    if (client) {
        await client.close();
    }
}
