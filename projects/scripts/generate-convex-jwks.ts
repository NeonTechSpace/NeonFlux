import { pathToFileURL } from 'node:url';

import { loadLocalEnv } from '../packages/config/src/env.js';
import { createConvexAuthJwksDataUriFromEnv } from './convex-jwks.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main();
    } catch (error: unknown) {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    }
}

function main(): void {
    loadLocalEnv();
    const provider = process.argv[2];

    if (provider !== 'bot' && provider !== 'web' && provider !== 'user') {
        throw new Error('Usage: pnpm generate:convex-jwks <bot|web|user>');
    }

    const jwksDataUri = createConvexAuthJwksDataUriFromEnv(process.env, provider);

    process.stdout.write(`${jwksDataUri}\n`);
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
