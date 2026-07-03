import { createHash } from 'node:crypto';

import { convexMigrationTables } from '../migration-tables.js';
import { stableJson } from './stable-json.js';
import type { MigrationManifest, MigrationTableExport, TransformedMigrationTable } from './types.js';

export const convexMigrationToolVersion = 'phase-5.0';

export function createSchemaInventoryHash(): string {
    return sha256(
        stableJson(
            convexMigrationTables.map((table) => ({
                convexTable: table.convexTable,
                domain: table.domain,
                postgresTable: table.postgresTable,
                risk: table.risk,
            }))
        )
    );
}

export function createExportManifest(input: {
    createdAt?: Date;
    migrationHead: string;
    revision: string;
    sourceDatabaseId: string;
    tables: MigrationTableExport[];
    toolVersion?: string;
}): MigrationManifest {
    return createManifest({
        createdAt: input.createdAt ?? new Date(),
        migrationHead: input.migrationHead,
        revision: input.revision,
        sourceDatabaseId: input.sourceDatabaseId,
        tableChecksums: Object.fromEntries(
            input.tables.map((table) => [table.postgresTable, checksumRows(table.rows)])
        ),
        tableCounts: Object.fromEntries(input.tables.map((table) => [table.postgresTable, table.rows.length])),
        toolVersion: input.toolVersion ?? convexMigrationToolVersion,
    });
}

export function createTransformedManifest(input: {
    createdAt?: Date;
    migrationHead: string;
    revision: string;
    sourceDatabaseId: string;
    tables: TransformedMigrationTable[];
    toolVersion?: string;
}): MigrationManifest {
    return createManifest({
        createdAt: input.createdAt ?? new Date(),
        migrationHead: input.migrationHead,
        revision: input.revision,
        sourceDatabaseId: input.sourceDatabaseId,
        tableChecksums: Object.fromEntries(input.tables.map((table) => [table.convexTable, checksumRows(table.docs)])),
        tableCounts: Object.fromEntries(input.tables.map((table) => [table.convexTable, table.docs.length])),
        toolVersion: input.toolVersion ?? convexMigrationToolVersion,
    });
}

export function checksumRows(rows: readonly unknown[]): string {
    return sha256(stableJson([...rows].sort((left, right) => stableJson(left).localeCompare(stableJson(right)))));
}

function createManifest(input: Omit<MigrationManifest, 'createdAt' | 'schemaInventoryHash'> & { createdAt: Date }) {
    return {
        createdAt: input.createdAt.toISOString(),
        migrationHead: input.migrationHead,
        revision: input.revision,
        schemaInventoryHash: createSchemaInventoryHash(),
        sourceDatabaseId: input.sourceDatabaseId,
        tableChecksums: input.tableChecksums,
        tableCounts: input.tableCounts,
        toolVersion: input.toolVersion,
    };
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
