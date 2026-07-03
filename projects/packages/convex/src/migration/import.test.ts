import { describe, expect, it } from 'vitest';

import { convexMigrationTables } from '../migration-tables.js';
import { createTransformedManifest } from './manifest.js';
import { assertImportTargetReady, importTransformedMigrationBundle, type MigrationImportTarget } from './index.js';
import type { MigrationDocument, TransformedMigrationBundle } from './types.js';

describe('migration import guard', () => {
    it('requires an explicit target deployment', async () => {
        await expect(
            assertImportTargetReady(new FakeImportTarget({}), {
                targetDeployment: '   ',
            })
        ).rejects.toThrow('explicit target deployment');
    });

    it('refuses non-empty targets without backup-and-replace approval', async () => {
        await expect(
            assertImportTargetReady(new FakeImportTarget({ guilds: 1 }), {
                targetDeployment: 'prod:neonflux',
            })
        ).rejects.toThrow('Refusing to import into non-empty Convex target');
    });

    it('imports tables in inventory order when the target is explicitly replaceable', async () => {
        const target = new FakeImportTarget({ guilds: 1 });
        const bundle = createBundle({
            guilds: [{ guildId: 'guild-1' }],
        });

        const result = await importTransformedMigrationBundle(target, bundle, {
            allowBackupAndReplace: true,
            serviceJwt: 'service-jwt',
            targetDeployment: 'prod:neonflux',
        });

        expect(result.insertedCounts.guilds).toBe(1);
        expect(target.insertedTables).toEqual(convexMigrationTables.map((table) => table.convexTable));
    });
});

class FakeImportTarget implements MigrationImportTarget {
    readonly insertedTables: string[] = [];
    readonly name = 'fake-target';

    constructor(private readonly counts: Record<string, number>) {}

    countDocuments(table: string): Promise<number> {
        return Promise.resolve(this.counts[table] ?? 0);
    }

    insertDocuments(table: string): Promise<void> {
        this.insertedTables.push(table);
        return Promise.resolve();
    }
}

function createBundle(overrides: Record<string, MigrationDocument[]>): TransformedMigrationBundle {
    const tables = convexMigrationTables.map((table) => ({
        convexTable: table.convexTable,
        docs: overrides[table.convexTable] ?? [],
        postgresTable: table.postgresTable,
    }));

    return {
        manifest: createTransformedManifest({
            createdAt: new Date('2026-07-03T00:00:00.000Z'),
            migrationHead: '0028_reaction_role_builder_modes',
            revision: 'test-revision',
            sourceDatabaseId: 'test-db',
            tables,
        }),
        tables,
    };
}
