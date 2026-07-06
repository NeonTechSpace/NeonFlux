import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { assertNoArgs } from './script-args.js';

const modulusLength = 2048;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main();
    } catch (error: unknown) {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    }
}

export function createConvexPrivateKeyPem(): string {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength,
    });

    return privateKey.export({ format: 'pem', type: 'pkcs8' });
}

export function createConvexPrivateKeyEnvValue(): string {
    return createConvexPrivateKeyPem().trim().replace(/\r?\n/gu, '\\n');
}

function main(): void {
    assertNoArgs();
    process.stdout.write(`${createConvexPrivateKeyEnvValue()}\n`);
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
