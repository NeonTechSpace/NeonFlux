import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { createLogger } from '@neonflux/core/logging';
import type { AppLogger } from '@neonflux/core/logging';

let logger: AppLogger | undefined;

export function getWebLogger(): AppLogger {
    logger ??= createLogger(loadWebConfig());
    return logger;
}
