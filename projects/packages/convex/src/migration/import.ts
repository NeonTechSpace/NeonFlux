import { convexMigrationTables } from '../migration-tables.js';
import type {
    MigrationImportOptions,
    MigrationImportResult,
    MigrationImportTarget,
    TransformedMigrationBundle,
} from './types.js';

export type AssertImportTargetReadyOptions = {
    allowBackupAndReplace?: boolean;
    targetDeployment: string;
};

export async function importTransformedMigrationBundle(
    target: MigrationImportTarget,
    bundle: TransformedMigrationBundle,
    options: MigrationImportOptions
): Promise<MigrationImportResult> {
    await assertImportTargetReady(target, options);

    const insertedCounts: Record<string, number> = {};

    for (const inventoryTable of convexMigrationTables) {
        const table = bundle.tables.find((candidate) => candidate.convexTable === inventoryTable.convexTable);

        if (!table) {
            throw new Error(`Cannot import missing transformed table ${inventoryTable.convexTable}`);
        }

        await target.insertDocuments(table.convexTable, table.docs, options.serviceJwt);
        insertedCounts[table.convexTable] = table.docs.length;
    }

    return {
        insertedCounts,
        targetDeployment: options.targetDeployment,
    };
}

export async function assertImportTargetReady(
    target: MigrationImportTarget,
    options: AssertImportTargetReadyOptions
): Promise<void> {
    if (!options.targetDeployment.trim()) {
        throw new Error('Convex migration import requires an explicit target deployment');
    }

    const nonEmptyTables: string[] = [];

    for (const table of convexMigrationTables) {
        const count = await target.countDocuments(table.convexTable);

        if (count > 0) {
            nonEmptyTables.push(`${table.convexTable}=${String(count)}`);
        }
    }

    if (nonEmptyTables.length > 0 && !options.allowBackupAndReplace) {
        throw new Error(`Refusing to import into non-empty Convex target ${target.name}: ${nonEmptyTables.join(', ')}`);
    }
}
