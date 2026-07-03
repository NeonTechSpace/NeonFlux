import { convexMigrationTables } from '../migration-tables.js';
import { stableJson } from './stable-json.js';
import type {
    MigrationDocument,
    MigrationValidationIssue,
    MigrationValidationReport,
    TransformedMigrationBundle,
} from './types.js';
import {
    defaultCounterRules,
    defaultEventOrderingRules,
    defaultUniqueKeyRules,
    type CounterRule,
    type EventOrderingRule,
    type UniqueKeyRule,
} from './rules.js';

export type ValidateMigrationOptions = {
    checkedAt?: Date;
    counterRules?: readonly CounterRule[];
    eventOrderingRules?: readonly EventOrderingRule[];
    forbiddenSamples?: readonly string[];
    uniqueKeyRules?: readonly UniqueKeyRule[];
};

export function validateTransformedMigrationBundle(
    bundle: TransformedMigrationBundle,
    options: ValidateMigrationOptions = {}
): MigrationValidationReport {
    const tablesByName = new Map(bundle.tables.map((table) => [table.convexTable, table.docs]));
    const issues: MigrationValidationIssue[] = [];

    issues.push(...validateInventory(tablesByName));
    issues.push(...validateCounts(bundle, tablesByName));
    issues.push(...validateLegacyIds(tablesByName));
    issues.push(...validateUniqueKeys(tablesByName, options.uniqueKeyRules ?? defaultUniqueKeyRules));
    issues.push(...validateReferences(tablesByName));
    issues.push(...validateCounters(tablesByName, options.counterRules ?? defaultCounterRules));
    issues.push(...validateEventOrdering(tablesByName, options.eventOrderingRules ?? defaultEventOrderingRules));

    const report = createReport(bundle, issues, options.checkedAt ?? new Date());
    const secretLeakIssues = validateNoSecretMaterial(report, options.forbiddenSamples ?? []);
    const finalIssues = [...issues, ...secretLeakIssues];

    return createReport(bundle, finalIssues, options.checkedAt ?? new Date());
}

export function validateNoSecretMaterial(
    value: unknown,
    forbiddenSamples: readonly string[] = []
): MigrationValidationIssue[] {
    const serialized = stableJson(value);

    return forbiddenSamples
        .filter((sample) => sample.length > 0 && serialized.includes(sample))
        .map((sample) => ({
            code: 'secret-leak',
            message: `Migration report contains forbidden secret material matching ${sample.slice(0, 4)}...`,
        }));
}

function validateInventory(tablesByName: Map<string, readonly MigrationDocument[]>): MigrationValidationIssue[] {
    const expected = new Set(convexMigrationTables.map((table) => table.convexTable));
    const actual = new Set(tablesByName.keys());
    const issues: MigrationValidationIssue[] = [];

    for (const table of expected) {
        if (!actual.has(table)) {
            issues.push({
                code: 'inventory-mismatch',
                message: `Missing transformed table ${table}`,
                table,
            });
        }
    }

    for (const table of actual) {
        if (!expected.has(table)) {
            issues.push({
                code: 'inventory-mismatch',
                message: `Unexpected transformed table ${table}`,
                table,
            });
        }
    }

    return issues;
}

function validateCounts(
    bundle: TransformedMigrationBundle,
    tablesByName: Map<string, readonly MigrationDocument[]>
): MigrationValidationIssue[] {
    return [...tablesByName.entries()].flatMap(([table, docs]) => {
        const manifestCount = bundle.manifest.tableCounts[table];

        return manifestCount === docs.length
            ? []
            : [
                  {
                      code: 'count-mismatch' as const,
                      detail: { actual: docs.length, expected: manifestCount ?? null },
                      message: `Manifest count for ${table} does not match transformed document count`,
                      table,
                  },
              ];
    });
}

function validateLegacyIds(tablesByName: Map<string, readonly MigrationDocument[]>): MigrationValidationIssue[] {
    const issues: MigrationValidationIssue[] = [];

    for (const [table, docs] of tablesByName) {
        const seen = new Set<string>();

        for (const doc of docs) {
            if (typeof doc.legacyId !== 'string') {
                continue;
            }

            if (seen.has(doc.legacyId)) {
                issues.push({
                    code: 'duplicate-legacy-id',
                    message: `Duplicate legacyId in ${table}`,
                    table,
                });
            }

            seen.add(doc.legacyId);
        }
    }

    return issues;
}

function validateUniqueKeys(
    tablesByName: Map<string, readonly MigrationDocument[]>,
    rules: readonly UniqueKeyRule[]
): MigrationValidationIssue[] {
    const issues: MigrationValidationIssue[] = [];

    for (const rule of rules) {
        const docs = tablesByName.get(rule.table) ?? [];
        const seen = new Set<string>();

        for (const doc of docs) {
            const values = rule.fields.map((field) => doc[field]);

            if (values.some((value) => value === undefined || value === null)) {
                continue;
            }

            const key = stableJson(values);

            if (seen.has(key)) {
                issues.push({
                    code: 'unique-key-violation',
                    detail: { fields: [...rule.fields] },
                    message: `Unique key ${rule.name} is duplicated`,
                    table: rule.table,
                });
            }

            seen.add(key);
        }
    }

    return issues;
}

function validateReferences(tablesByName: Map<string, readonly MigrationDocument[]>): MigrationValidationIssue[] {
    const importedLegacyIds = new Set<string>();

    for (const docs of tablesByName.values()) {
        for (const doc of docs) {
            if (typeof doc.legacyId === 'string') {
                importedLegacyIds.add(doc.legacyId);
            }
        }
    }

    const issues: MigrationValidationIssue[] = [];

    for (const [table, docs] of tablesByName) {
        for (const doc of docs) {
            for (const [field, value] of Object.entries(doc)) {
                if (!field.endsWith('LegacyId') || typeof value !== 'string') {
                    continue;
                }

                if (!importedLegacyIds.has(value)) {
                    issues.push({
                        code: 'missing-reference',
                        detail: { field },
                        message: `${field} does not point at an imported legacyId`,
                        table,
                    });
                }
            }
        }
    }

    return issues;
}

function validateCounters(
    tablesByName: Map<string, readonly MigrationDocument[]>,
    rules: readonly CounterRule[]
): MigrationValidationIssue[] {
    return rules.flatMap((rule) => {
        const counters = tablesByName.get(rule.counterTable) ?? [];
        const facts = tablesByName.get(rule.factTable) ?? [];
        const maxByScope = new Map<string, number>();

        for (const fact of facts) {
            const scope = fact[rule.scopeField];
            const value = fact[rule.factField];

            if (typeof scope === 'string' && typeof value === 'number') {
                maxByScope.set(scope, Math.max(maxByScope.get(scope) ?? 0, value));
            }
        }

        return counters.flatMap((counter) => {
            const scope = counter[rule.scopeField];
            const value = counter[rule.counterField];
            const max = typeof scope === 'string' ? maxByScope.get(scope) : undefined;

            return typeof scope === 'string' && typeof value === 'number' && max !== undefined && value <= max
                ? [
                      {
                          code: 'stale-counter' as const,
                          detail: { counterValue: value, maxObserved: max, scope },
                          message: `${rule.name} is not above the imported max value`,
                          table: rule.counterTable,
                      },
                  ]
                : [];
        });
    });
}

function validateEventOrdering(
    tablesByName: Map<string, readonly MigrationDocument[]>,
    rules: readonly EventOrderingRule[]
): MigrationValidationIssue[] {
    const issues: MigrationValidationIssue[] = [];

    for (const rule of rules) {
        const latestByParent = new Map<string, number>();

        for (const doc of tablesByName.get(rule.table) ?? []) {
            const timestamp = doc[rule.timestampField];
            const parent = rule.parentField ? doc[rule.parentField] : rule.table;

            if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
                issues.push({
                    code: 'event-ordering',
                    detail: { field: rule.timestampField },
                    message: `Event timestamp ${rule.timestampField} is not a valid ISO timestamp`,
                    table: rule.table,
                });
                continue;
            }

            const parentKey = typeof parent === 'string' ? parent : rule.table;
            const current = Date.parse(timestamp);
            const previous = latestByParent.get(parentKey);

            if (previous !== undefined && current < previous) {
                issues.push({
                    code: 'event-ordering',
                    detail: { field: rule.timestampField },
                    message: `Event ordering moved backwards for ${parentKey}`,
                    table: rule.table,
                });
            }

            latestByParent.set(parentKey, current);
        }
    }

    return issues;
}

function createReport(
    bundle: TransformedMigrationBundle,
    issues: MigrationValidationIssue[],
    checkedAt: Date
): MigrationValidationReport {
    return {
        checkedAt: checkedAt.toISOString(),
        issueCount: issues.length,
        issues,
        ok: issues.length === 0,
        tableCounts: bundle.manifest.tableCounts,
    };
}
