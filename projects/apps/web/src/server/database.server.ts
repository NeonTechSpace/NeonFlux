import '@tanstack/react-start/server-only';

import { loadConfig } from '@neonflux/config';
import { createDatabaseClient } from '@neonflux/db';
import type { DatabaseClient } from '@neonflux/db';

let webDatabaseClient: DatabaseClient | undefined;

export function getWebDatabaseClient(): DatabaseClient {
    if (webDatabaseClient) {
        return webDatabaseClient;
    }

    const config = loadConfig();

    webDatabaseClient = createDatabaseClient(config.databaseUrl);

    return webDatabaseClient;
}

export async function closeWebDatabaseClient(): Promise<void> {
    const client = webDatabaseClient;

    webDatabaseClient = undefined;

    if (client) {
        await client.close();
    }
}
