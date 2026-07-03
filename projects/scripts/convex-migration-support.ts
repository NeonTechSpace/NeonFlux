import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { MigrationExportBundle, TransformedMigrationBundle } from '../packages/convex/src/migration/index.js';

const execFileAsync = promisify(execFile);

export function readRequiredArg(name: string): string {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? process.argv[index + 1] : undefined;

    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

export function readRequiredEnv(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

export function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

export async function readExportBundle(path: string): Promise<MigrationExportBundle> {
    return JSON.parse(await readFile(path, 'utf8')) as MigrationExportBundle;
}

export async function readTransformedBundle(path: string): Promise<TransformedMigrationBundle> {
    return JSON.parse(await readFile(path, 'utf8')) as TransformedMigrationBundle;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readDrizzleMigrationHead(): Promise<string> {
    const journalPath = join(process.cwd(), 'packages', 'db', 'drizzle', 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
        entries?: Array<{ tag?: string }>;
    };
    const tag = journal.entries?.at(-1)?.tag;

    if (!tag) {
        throw new Error('Could not read Drizzle migration head from packages/db/drizzle/meta/_journal.json');
    }

    return tag;
}

export async function readWorkspaceRevision(): Promise<string> {
    return (
        (await tryExec('jj', ['log', '-r', '@', '--no-graph', '-T', 'change_id.short()'])) ??
        (await tryExec('git', ['rev-parse', 'HEAD'])) ??
        'unknown'
    );
}

async function tryExec(command: string, args: readonly string[]): Promise<string | undefined> {
    try {
        const result = await execFileAsync(command, args);
        const value = result.stdout.trim();

        return value || undefined;
    } catch {
        return undefined;
    }
}
