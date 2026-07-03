import { convexMigrationTables } from '../migration-tables.js';
import { createExportManifest } from './manifest.js';
import type {
    MigrationExportBundle,
    MigrationTableExport,
    MigrationTableSelection,
    PostgresColumnMetadata,
    PostgresRow,
} from './types.js';

type QueryResult<T> = { rows: T[] };

export type PostgresMigrationClient = {
    query<T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        values?: readonly unknown[]
    ): Promise<QueryResult<T>>;
};

export type ExportPostgresMigrationOptions = {
    createdAt?: Date;
    migrationHead: string;
    revision: string;
    sourceDatabaseId: string;
    tables?: MigrationTableSelection;
};

export async function exportPostgresMigrationBundle(
    client: PostgresMigrationClient,
    options: ExportPostgresMigrationOptions
): Promise<MigrationExportBundle> {
    const tables = [...(options.tables ?? convexMigrationTables)];
    const availableTables = await loadAvailablePublicTables(client);
    const missingTables = tables.filter((table) => !availableTables.has(table.postgresTable));

    if (missingTables.length > 0) {
        throw new Error(
            `Missing migration inventory table(s): ${missingTables.map((table) => table.postgresTable).join(', ')}`
        );
    }

    const columnsByTable = await loadPublicTableColumns(
        client,
        tables.map((table) => table.postgresTable)
    );
    const exportedTables: MigrationTableExport[] = [];

    for (const table of tables) {
        const columns = columnsByTable.get(table.postgresTable) ?? [];
        const result = await client.query<PostgresRow>(
            `select * from ${quoteIdentifier(table.postgresTable)}${createOrderClause(columns)};`
        );

        exportedTables.push({
            columns,
            convexTable: table.convexTable,
            postgresTable: table.postgresTable,
            rows: result.rows,
        });
    }

    return {
        manifest: createExportManifest({
            ...(options.createdAt ? { createdAt: options.createdAt } : {}),
            migrationHead: options.migrationHead,
            revision: options.revision,
            sourceDatabaseId: options.sourceDatabaseId,
            tables: exportedTables,
        }),
        tables: exportedTables,
    };
}

export function quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

export function createOrderClause(columns: readonly PostgresColumnMetadata[]): string {
    const columnNames = new Set(columns.map((column) => column.name));
    const preferredColumns = ['guild_id', 'created_at', 'occurred_at', 'granted_at', 'opened_at', 'id'].filter((name) =>
        columnNames.has(name)
    );

    if (preferredColumns.length === 0) {
        return '';
    }

    return ` order by ${preferredColumns.map((column) => `${quoteIdentifier(column)} asc`).join(', ')}`;
}

async function loadAvailablePublicTables(client: PostgresMigrationClient): Promise<Set<string>> {
    const result = await client.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = 'public';
    `);

    return new Set(result.rows.map((row) => row.table_name));
}

async function loadPublicTableColumns(
    client: PostgresMigrationClient,
    tableNames: readonly string[]
): Promise<Map<string, PostgresColumnMetadata[]>> {
    if (tableNames.length === 0) {
        return new Map();
    }

    const result = await client.query<{
        column_name: string;
        data_type: string;
        table_name: string;
        udt_name: string;
    }>(
        `
            select table_name, column_name, data_type, udt_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = any($1)
            order by table_name, ordinal_position;
        `,
        [tableNames]
    );
    const columnsByTable = new Map<string, PostgresColumnMetadata[]>();

    for (const row of result.rows) {
        const columns = columnsByTable.get(row.table_name) ?? [];
        columns.push({
            dataType: row.data_type,
            name: row.column_name,
            udtName: row.udt_name,
        });
        columnsByTable.set(row.table_name, columns);
    }

    return columnsByTable;
}
