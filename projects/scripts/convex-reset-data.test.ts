import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    getConvexSchemaTableNames,
    parseResetDataArgs,
    readFileBuffer,
    validateResetDataArgs,
    writeEmptyConvexSnapshotZip,
} from './convex-reset-data.js';

describe('convex reset data script', () => {
    it('parses guarded destination arguments', () => {
        expect(parseResetDataArgs(['--deployment', 'local', '--yes'])).toStrictEqual({
            confirmProductionReset: false,
            convexArgs: ['--deployment', 'local'],
            dryRun: false,
            yes: true,
        });
        expect(parseResetDataArgs(['--deployment=dev', '--dry-run'])).toStrictEqual({
            confirmProductionReset: false,
            convexArgs: ['--deployment=dev'],
            dryRun: true,
            yes: false,
        });
    });

    it('requires explicit confirmation for destructive and production resets', () => {
        expect(() =>
            validateResetDataArgs({
                confirmProductionReset: false,
                convexArgs: ['--deployment', 'local'],
                dryRun: false,
                yes: false,
            })
        ).toThrow('without --yes');

        expect(() =>
            validateResetDataArgs({
                confirmProductionReset: false,
                convexArgs: ['--prod'],
                dryRun: false,
                yes: true,
            })
        ).toThrow('without --confirm-production-reset');
    });

    it('reads table names from the current Convex schema', () => {
        expect(getConvexSchemaTableNames()).toContain('structureBackups');
    });

    it('writes an empty snapshot zip with one documents file per table', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'neonflux-convex-reset-test-'));
        const snapshotPath = join(tempDir, 'empty.zip');

        try {
            await writeEmptyConvexSnapshotZip(snapshotPath, ['guilds', 'structureBackups']);
            const content = await readFileBuffer(snapshotPath);

            expect(content.toString('utf8')).toContain('guilds/documents.jsonl');
            expect(content.toString('utf8')).toContain('structureBackups/documents.jsonl');
        } finally {
            await rm(tempDir, { force: true, recursive: true });
        }
    });
});
