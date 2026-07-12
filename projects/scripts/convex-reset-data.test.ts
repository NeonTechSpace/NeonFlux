import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    getConvexSchemaTableNames,
    parseResetDataArgs,
    readFileBuffer,
    writeEmptyConvexSnapshotZip,
} from './convex-reset-data.js';

describe('convex reset data script', () => {
    it('targets development by default and production only with --prod', () => {
        expect(parseResetDataArgs([])).toStrictEqual({ production: false });
        expect(parseResetDataArgs(['--prod'])).toStrictEqual({ production: true });
        expect(parseResetDataArgs(['--', '--prod'])).toStrictEqual({ production: true });
    });

    it('rejects every other option', () => {
        expect(() => parseResetDataArgs(['--deployment', 'dev'])).toThrow('Unexpected argument: --deployment');
        expect(() => parseResetDataArgs(['--yes'])).toThrow('Unexpected argument: --yes');
    });

    it('enumerates every schema table in stable order and rejects missing definitions', () => {
        const schema = {
            tables: {
                structureBackups: {},
                guilds: {},
                auditEvents: {},
            },
        };

        expect(getConvexSchemaTableNames(schema)).toStrictEqual(['auditEvents', 'guilds', 'structureBackups']);
        expect(() => getConvexSchemaTableNames({})).toThrow('Convex schema did not expose table definitions.');

        const currentSchemaTables = getConvexSchemaTableNames();
        expect(currentSchemaTables.length).toBeGreaterThan(0);
        expect(new Set(currentSchemaTables).size).toBe(currentSchemaTables.length);
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
