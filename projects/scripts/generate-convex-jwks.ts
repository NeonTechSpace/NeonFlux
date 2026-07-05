import { pathToFileURL } from 'node:url';

import { loadLocalEnv } from '../packages/config/src/env.js';
import { createConvexAuthJwksDataUriFromEnv } from './convex-jwks.js';
import { assertNoArgs } from './script-args.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main();
    } catch (error: unknown) {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    }
}

function main(): void {
    assertNoArgs();
    loadLocalEnv();

    const jwksDataUri = createConvexAuthJwksDataUriFromEnv();

    process.stdout.write(`${jwksDataUri}\n`);
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
