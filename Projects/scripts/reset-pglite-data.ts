import type { Dirent } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const dataRoot = join(projectRoot, 'data');

const deletedDirectories = await removePgliteDataDirectories();

if (deletedDirectories.length === 0) {
    process.stdout.write('No local PGlite data directories found.\n');
} else {
    process.stdout.write(`Deleted ${String(deletedDirectories.length)} local PGlite data directories.\n`);
}

async function removePgliteDataDirectories(): Promise<string[]> {
    let entries: Dirent[];

    try {
        entries = await readdir(dataRoot, { withFileTypes: true });
    } catch (error) {
        if (isMissingPathError(error)) {
            return [];
        }

        throw error;
    }

    const pgliteDirectories = entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('pglite-'))
        .map((entry) => entry.name);

    await Promise.all(
        pgliteDirectories.map((directoryName) => rm(join(dataRoot, directoryName), { recursive: true, force: true }))
    );

    return pgliteDirectories;
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
