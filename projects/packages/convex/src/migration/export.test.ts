import { describe, expect, it } from 'vitest';

import { convexMigrationTableCount, convexMigrationTables } from '../migration-tables.js';
import { createOrderClause, exportPostgresMigrationBundle, type PostgresMigrationClient } from './export.js';

describe('Postgres migration export', () => {
    it('exports every inventory table exactly once', async () => {
        const client = new FakePostgresClient(convexMigrationTables.map((table) => table.postgresTable));

        const bundle = await exportPostgresMigrationBundle(client.asMigrationClient(), {
            createdAt: new Date('2026-07-03T00:00:00.000Z'),
            migrationHead: '0028_reaction_role_builder_modes',
            revision: 'test-revision',
            sourceDatabaseId: 'test-db',
        });

        expect(bundle.tables).toHaveLength(convexMigrationTableCount);
        expect(new Set(client.selectedTables).size).toBe(convexMigrationTableCount);
        expect(client.selectedTables).toEqual(convexMigrationTables.map((table) => table.postgresTable));
    });

    it('fails when a table from the inventory is missing', async () => {
        const client = new FakePostgresClient(
            convexMigrationTables.map((table) => table.postgresTable).filter((table) => table !== 'guilds')
        );

        await expect(
            exportPostgresMigrationBundle(client.asMigrationClient(), {
                migrationHead: 'head',
                revision: 'revision',
                sourceDatabaseId: 'db',
            })
        ).rejects.toThrow('Missing migration inventory table(s): guilds');
    });

    it('uses stable ordering columns when they are present', () => {
        expect(createOrderClause([{ name: 'id' }, { name: 'guild_id' }, { name: 'created_at' }])).toBe(
            ' order by "guild_id" asc, "created_at" asc, "id" asc'
        );
    });
});

class FakePostgresClient {
    readonly selectedTables: string[] = [];

    constructor(private readonly availableTables: readonly string[]) {}

    asMigrationClient(): PostgresMigrationClient {
        return this as unknown as PostgresMigrationClient;
    }

    query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> {
        if (sql.includes('information_schema.tables')) {
            return Promise.resolve({
                rows: this.availableTables.map((table) => ({ table_name: table })),
            });
        }

        if (sql.includes('information_schema.columns')) {
            return Promise.resolve({
                rows: this.availableTables.flatMap((table) => [
                    {
                        column_name: 'id',
                        data_type: 'uuid',
                        table_name: table,
                        udt_name: 'uuid',
                    },
                ]),
            });
        }

        const table = /from "([^"]+)"/u.exec(sql)?.[1];

        if (!table) {
            throw new Error(`Unexpected SQL: ${sql}`);
        }

        this.selectedTables.push(table);

        return Promise.resolve({
            rows: [],
        });
    }
}
