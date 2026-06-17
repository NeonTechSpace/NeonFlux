import { Client, Events } from '@fluxerjs/core';

import type { AppConfig } from '@neonflux/config';
import type { AppLogger } from '@neonflux/core/logging';

export type FluxerBot = ReturnType<typeof createFluxerBot>;

export function createFluxerBot(config: AppConfig, logger: AppLogger) {
    const client = new Client();

    client.once(Events.Ready, () => {
        logger.info('fluxer.ready', {
            instanceMode: config.instanceMode,
        });
    });

    return {
        client,
        async start(): Promise<boolean> {
            if (!config.fluxerBotToken) {
                logger.warn('fluxer.token_missing');
                return false;
            }

            await client.login(config.fluxerBotToken);
            return true;
        },
        async stop(): Promise<void> {
            await client.destroy();
        },
    };
}
