import { validateTransformedMigrationBundle } from '../packages/convex/src/migration/index.js';
import { readRequiredArg, readTransformedBundle, writeJson } from './convex-migration-support.js';

const inputPath = readRequiredArg('--in');
const reportPath = readRequiredArg('--report');
const bundle = await readTransformedBundle(inputPath);
const report = validateTransformedMigrationBundle(bundle, {
    forbiddenSamples: process.argv
        .map((value, index) => (value === '--forbid' ? process.argv[index + 1] : undefined))
        .filter((value): value is string => Boolean(value)),
});

await writeJson(reportPath, report);

if (!report.ok) {
    process.stderr.write(`Convex migration validation failed with ${String(report.issueCount)} issue(s).\n`);
    process.exitCode = 1;
} else {
    process.stdout.write(`Convex migration validation passed. Wrote report to ${reportPath}\n`);
}
