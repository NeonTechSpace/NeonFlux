import type { ConvexMigrationTable } from '../migration-tables.js';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PostgresFieldType = string;

export type PostgresColumnMetadata = {
    dataType?: PostgresFieldType;
    name: string;
    udtName?: string;
};

export type PostgresPrimitive = bigint | boolean | Date | null | number | string | Uint8Array;
export type PostgresValue = PostgresPrimitive | PostgresValue[] | { [key: string]: PostgresValue };
export type PostgresRow = Record<string, PostgresValue | undefined>;

export type MigrationTableExport = {
    columns: PostgresColumnMetadata[];
    convexTable: string;
    postgresTable: string;
    rows: PostgresRow[];
};

export type TransformedMigrationTable = {
    convexTable: string;
    docs: MigrationDocument[];
    postgresTable: string;
};

export type MigrationDocument = Record<string, JsonValue | undefined>;

export type MigrationManifest = {
    createdAt: string;
    migrationHead: string;
    revision: string;
    schemaInventoryHash: string;
    sourceDatabaseId: string;
    tableChecksums: Record<string, string>;
    tableCounts: Record<string, number>;
    toolVersion: string;
};

export type MigrationExportBundle = {
    manifest: MigrationManifest;
    tables: MigrationTableExport[];
};

export type TransformedMigrationBundle = {
    manifest: MigrationManifest;
    tables: TransformedMigrationTable[];
};

export type MigrationValidationIssue = {
    code:
        | 'count-mismatch'
        | 'duplicate-legacy-id'
        | 'event-ordering'
        | 'inventory-mismatch'
        | 'missing-reference'
        | 'secret-leak'
        | 'stale-counter'
        | 'unique-key-violation';
    detail?: JsonValue;
    message: string;
    table?: string;
};

export type MigrationValidationReport = {
    checkedAt: string;
    issueCount: number;
    issues: MigrationValidationIssue[];
    ok: boolean;
    tableCounts: Record<string, number>;
};

export type MigrationImportTarget = {
    clearDocuments?(table: string, serviceJwt: string): Promise<number>;
    countDocuments(table: string): Promise<number>;
    insertDocuments(table: string, docs: MigrationDocument[], serviceJwt: string): Promise<void>;
    name: string;
};

export type MigrationImportOptions = {
    allowBackupAndReplace?: boolean;
    serviceJwt: string;
    targetDeployment: string;
};

export type MigrationImportResult = {
    insertedCounts: Record<string, number>;
    targetDeployment: string;
};

export type MigrationTableSelection = readonly ConvexMigrationTable[];
