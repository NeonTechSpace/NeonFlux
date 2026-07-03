import { createTransformedManifest } from './manifest.js';
import type {
    JsonValue,
    MigrationDocument,
    MigrationExportBundle,
    PostgresColumnMetadata,
    PostgresValue,
    TransformedMigrationBundle,
    TransformedMigrationTable,
} from './types.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function transformMigrationBundle(bundle: MigrationExportBundle): TransformedMigrationBundle {
    const tables = bundle.tables.map(transformMigrationTable);

    return {
        manifest: createTransformedManifest({
            createdAt: new Date(bundle.manifest.createdAt),
            migrationHead: bundle.manifest.migrationHead,
            revision: bundle.manifest.revision,
            sourceDatabaseId: bundle.manifest.sourceDatabaseId,
            tables,
            toolVersion: bundle.manifest.toolVersion,
        }),
        tables,
    };
}

export function transformMigrationTable(input: {
    columns: PostgresColumnMetadata[];
    convexTable: string;
    postgresTable: string;
    rows: Array<Record<string, PostgresValue | undefined>>;
}): TransformedMigrationTable {
    return {
        convexTable: input.convexTable,
        docs: input.rows.map((row) => transformPostgresRow(row, input.columns)),
        postgresTable: input.postgresTable,
    };
}

export function transformPostgresRow(
    row: Record<string, PostgresValue | undefined>,
    columns: readonly PostgresColumnMetadata[] = []
): MigrationDocument {
    const metadataByName = new Map(columns.map((column) => [column.name, column]));
    const document: MigrationDocument = {};

    for (const [columnName, rawValue] of Object.entries(row)) {
        if (rawValue === null || rawValue === undefined) {
            continue;
        }

        const targetName = mapPostgresColumnName(columnName, rawValue, metadataByName.get(columnName));
        document[targetName] = serializePostgresValue(rawValue);
    }

    return document;
}

export function mapPostgresColumnName(
    columnName: string,
    value: PostgresValue | undefined,
    metadata?: PostgresColumnMetadata
): string {
    const isUuid = isUuidColumn(metadata, value);

    if (columnName === 'id' && isUuid) {
        return 'legacyId';
    }

    if (columnName.endsWith('_id') && isUuid) {
        return `${snakeToCamel(columnName.slice(0, -3))}LegacyId`;
    }

    return snakeToCamel(columnName);
}

export function serializePostgresValue(value: PostgresValue): JsonValue {
    if (value === null) {
        return null;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('base64');
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializePostgresValue(item));
    }

    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializePostgresValue(nested)]));
    }

    return value;
}

function isUuidColumn(metadata: PostgresColumnMetadata | undefined, value: PostgresValue | undefined): boolean {
    if (metadata?.dataType === 'uuid' || metadata?.udtName === 'uuid') {
        return true;
    }

    return typeof value === 'string' && uuidPattern.test(value);
}

function snakeToCamel(value: string): string {
    return value.replaceAll(/_([a-z0-9])/gu, (_match, character: string) => character.toUpperCase());
}
