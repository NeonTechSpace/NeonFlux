import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import convexSchema from '../convex/schema.js';
import { loadLocalEnv } from '../packages/config/src/env.js';
import { createConvexCliChildEnv } from './convex-cli.js';

type ResetDataArgs = {
    production: boolean;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    loadLocalEnv();

    const args = parseResetDataArgs(process.argv.slice(2));

    const tableNames = getConvexSchemaTableNames();
    const tempDir = await mkdtemp(join(tmpdir(), 'neonflux-convex-reset-'));
    const snapshotPath = join(tempDir, 'empty-convex-snapshot.zip');

    try {
        await writeEmptyConvexSnapshotZip(snapshotPath, tableNames);

        const convexArgs = ['import', '--replace-all', ...(args.production ? ['--prod'] : []), '--yes', snapshotPath];

        process.stdout.write(
            `${[
                `Prepared empty Convex snapshot for ${String(tableNames.length)} schema tables.`,
                `Tables: ${tableNames.join(', ')}`,
                `Convex command: convex ${convexArgs.slice(0, -1).join(' ')} <empty-snapshot.zip>`,
            ].join('\n')}\n`
        );

        const exitCode = await runConvexCli(convexArgs);
        process.exitCode = exitCode;
    } finally {
        await rm(tempDir, { force: true, recursive: true });
    }
}

export function parseResetDataArgs(argv: readonly string[]): ResetDataArgs {
    let production = false;

    for (const arg of argv) {
        if (arg === '--') {
            continue;
        }

        if (arg === '--prod') {
            production = true;
            continue;
        }

        throw new Error(`Unexpected argument: ${arg}`);
    }

    return { production };
}

export function getConvexSchemaTableNames(schema: { tables?: Record<string, unknown> } = convexSchema): string[] {
    const tables = schema.tables;
    if (!tables) throw new Error('Convex schema did not expose table definitions.');

    return Object.keys(tables).sort((left, right) => left.localeCompare(right));
}

export async function writeEmptyConvexSnapshotZip(path: string, tableNames: readonly string[]): Promise<void> {
    const entries = tableNames.map((tableName) => ({
        name: `${tableName}/documents.jsonl`,
        data: Buffer.alloc(0),
    }));

    await writeFile(path, createStoredZip(entries));
}

export async function readFileBuffer(path: string): Promise<Buffer> {
    return await readFile(path);
}

async function runConvexCli(args: readonly string[]): Promise<number> {
    const require = createRequire(import.meta.url);
    const convexBin = join(dirname(require.resolve('convex/package.json')), 'bin', 'main.js');
    const child = spawn(process.execPath, [convexBin, ...args], {
        env: createConvexCliChildEnv(process.env),
        shell: false,
        stdio: 'inherit',
    });

    return await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', (code) => resolve(code ?? 1));
    });
}

function createStoredZip(entries: ReadonlyArray<{ data: Buffer; name: string }>): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const localHeader = createLocalFileHeader(name, entry.data);
        const centralHeader = createCentralDirectoryHeader(name, entry.data, offset);

        localParts.push(localHeader, entry.data);
        centralParts.push(centralHeader);
        offset += localHeader.length + entry.data.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const localFiles = Buffer.concat(localParts);
    const end = createEndOfCentralDirectory(entries.length, centralDirectory.length, localFiles.length);

    return Buffer.concat([localFiles, centralDirectory, end]);
}

function createLocalFileHeader(name: Buffer, data: Buffer): Buffer {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);

    return Buffer.concat([header, name]);
}

function createCentralDirectoryHeader(name: Buffer, data: Buffer, offset: number): Buffer {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);

    return Buffer.concat([header, name]);
}

function createEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
    const header = Buffer.alloc(22);
    header.writeUInt32LE(0x06054b50, 0);
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(entryCount, 8);
    header.writeUInt16LE(entryCount, 10);
    header.writeUInt32LE(centralDirectorySize, 12);
    header.writeUInt32LE(centralDirectoryOffset, 16);
    header.writeUInt16LE(0, 20);

    return header;
}

function crc32(data: Buffer): number {
    let crc = 0xffffffff;

    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
