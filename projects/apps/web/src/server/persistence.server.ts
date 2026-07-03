import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { createRuntimePersistence, type RuntimePersistenceClient } from '@neonflux/persistence';

let webPersistenceClient: RuntimePersistenceClient | undefined;
let webPersistenceStart: Promise<RuntimePersistenceClient> | undefined;

export async function getWebPersistence(): Promise<RuntimePersistenceClient> {
    if (webPersistenceClient) {
        return webPersistenceClient;
    }

    if (webPersistenceStart) {
        return webPersistenceStart;
    }

    const config = loadWebConfig();

    webPersistenceStart = createRuntimePersistence(config, { serviceName: 'web' }).then((client) => {
        webPersistenceClient = client;
        webPersistenceStart = undefined;

        return client;
    });

    return webPersistenceStart;
}

export async function closeWebPersistence(): Promise<void> {
    const client = webPersistenceClient;

    webPersistenceClient = undefined;
    webPersistenceStart = undefined;

    if (client) {
        await client.close();
    }
}
