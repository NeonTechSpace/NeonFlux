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
        expect(parseResetDataArgs(['--deployment', 'dev', '--yes'])).toStrictEqual({
            confirmProductionReset: false,
            convexArgs: ['--deployment', 'dev'],
            dryRun: false,
            yes: true,
        });
        expect(parseResetDataArgs(['--prod', '--confirm-production-reset', '--dry-run'])).toStrictEqual({
            confirmProductionReset: true,
            convexArgs: ['--prod'],
            dryRun: true,
            yes: false,
        });
        expect(parseResetDataArgs(['--deployment=staging', '--dry-run'])).toStrictEqual({
            confirmProductionReset: false,
            convexArgs: ['--deployment=staging'],
            dryRun: true,
            yes: false,
        });
    });

    it('rejects local deployment resets because the wrapper targets hosted dev or prod deployments', () => {
        expect(() => parseResetDataArgs(['--deployment', 'local', '--yes'])).toThrow('Refusing --deployment local');
        expect(() => parseResetDataArgs(['--deployment=local', '--yes'])).toThrow('Refusing --deployment local');
    });

    it('requires explicit confirmation for destructive and production resets', () => {
        expect(() => validateResetDataArgs(parseResetDataArgs([]))).toThrow('without an explicit deployment target');

        expect(() =>
            validateResetDataArgs({
                confirmProductionReset: false,
                convexArgs: ['--deployment', 'dev'],
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

        for (const target of ['agile-capybara-631', 'other-project:prod', 'production']) {
            expect(() =>
                validateResetDataArgs({
                    confirmProductionReset: false,
                    convexArgs: ['--deployment', target],
                    dryRun: false,
                    yes: true,
                })
            ).toThrow('without --confirm-production-reset');
        }
    });

    it('allows explicit dev targets and dry-run inspection', () => {
        expect(() =>
            validateResetDataArgs({
                confirmProductionReset: false,
                convexArgs: [],
                dryRun: true,
                yes: false,
            })
        ).not.toThrow();

        expect(() =>
            validateResetDataArgs({
                confirmProductionReset: false,
                convexArgs: ['--deployment', 'dev'],
                dryRun: false,
                yes: true,
            })
        ).not.toThrow();

        expect(() =>
            validateResetDataArgs({
                confirmProductionReset: true,
                convexArgs: ['--deployment=agile-capybara-631'],
                dryRun: false,
                yes: true,
            })
        ).not.toThrow();
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
