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
    confirmProductionReset: boolean;
    convexArgs: string[];
    dryRun: boolean;
    yes: boolean;
};

const productionDeploymentRefs = new Set(['prod', 'production']);
const unsupportedDeploymentRefs = new Set(['local']);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    loadLocalEnv();

    const args = parseResetDataArgs(process.argv.slice(2));
    validateResetDataArgs(args);

    const tableNames = getConvexSchemaTableNames();
    const tempDir = await mkdtemp(join(tmpdir(), 'neonflux-convex-reset-'));
    const snapshotPath = join(tempDir, 'empty-convex-snapshot.zip');

    try {
        await writeEmptyConvexSnapshotZip(snapshotPath, tableNames);

        const convexArgs = [
            'import',
            '--replace-all',
            ...args.convexArgs,
            ...(args.yes ? ['--yes'] : []),
            snapshotPath,
        ];

        process.stdout.write(
            `${[
                `Prepared empty Convex snapshot for ${String(tableNames.length)} schema tables.`,
                `Tables: ${tableNames.join(', ')}`,
                `Convex command: convex ${convexArgs.slice(0, -1).join(' ')} <empty-snapshot.zip>`,
            ].join('\n')}\n`
        );

        if (args.dryRun) {
            process.stdout.write('Dry run only. Snapshot will be deleted.\n');
            return;
        }

        const exitCode = await runConvexCli(convexArgs);
        process.exitCode = exitCode;
    } finally {
        await rm(tempDir, { force: true, recursive: true });
    }
}

export function parseResetDataArgs(argv: readonly string[]): ResetDataArgs {
    const convexArgs: string[] = [];
    let confirmProductionReset = false;
    let dryRun = false;
    let yes = false;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--') {
            continue;
        }

        if (arg === '--confirm-production-reset') {
            confirmProductionReset = true;
            continue;
        }

        if (arg === '--dry-run') {
            dryRun = true;
            continue;
        }

        if (arg === '-y' || arg === '--yes') {
            yes = true;
            continue;
        }

        if (arg === '--prod') {
            convexArgs.push(arg);
            continue;
        }

        if (arg === '--deployment') {
            const value = argv[index + 1];
            if (!value) throw new Error('--deployment requires a value');
            validateSupportedDeploymentRef(value);
            convexArgs.push(arg, value);
            index += 1;
            continue;
        }

        if (arg?.startsWith('--deployment=')) {
            validateSupportedDeploymentRef(arg.slice('--deployment='.length));
            convexArgs.push(arg);
            continue;
        }

        throw new Error(`Unexpected argument: ${arg ?? ''}`);
    }

    return { confirmProductionReset, convexArgs, dryRun, yes };
}

function validateSupportedDeploymentRef(value: string): void {
    if (unsupportedDeploymentRefs.has(value.toLowerCase())) {
        throw new Error(
            'Refusing --deployment local for reset-data. Use --deployment dev for the hosted dev deployment, or create/select a local Convex deployment manually before using the Convex CLI directly.'
        );
    }
}

export function validateResetDataArgs(args: ResetDataArgs): void {
    if (!args.dryRun && !hasExplicitDeploymentTarget(args.convexArgs)) {
        throw new Error(
            'Refusing to reset Convex data without an explicit deployment target. Use --deployment dev, --deployment <deployment-name>, or --prod.'
        );
    }

    if (!args.yes && !args.dryRun) {
        throw new Error('Refusing to reset Convex data without --yes. Use --dry-run to inspect the generated command.');
    }

    if (isProductionTarget(args.convexArgs) && !args.confirmProductionReset) {
        throw new Error(
            'Refusing to reset a production Convex deployment without --confirm-production-reset. This deletes all documents.'
        );
    }
}

function hasExplicitDeploymentTarget(args: readonly string[]): boolean {
    return args.includes('--prod') || args.some((arg) => arg === '--deployment' || arg.startsWith('--deployment='));
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

function isProductionTarget(args: readonly string[]): boolean {
    if (args.includes('--prod')) return true;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--deployment' && productionDeploymentRefs.has((args[index + 1] ?? '').toLowerCase())) {
            return true;
        }
        if (arg?.startsWith('--deployment=')) {
            const value = arg.slice('--deployment='.length).toLowerCase();
            if (productionDeploymentRefs.has(value)) return true;
        }
    }

    return false;
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
