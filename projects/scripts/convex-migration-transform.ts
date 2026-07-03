import { transformMigrationBundle } from '../packages/convex/src/migration/index.js';
import { readExportBundle, readRequiredArg, writeJson } from './convex-migration-support.js';

const inputPath = readRequiredArg('--in');
const outputPath = readRequiredArg('--out');
const bundle = await readExportBundle(inputPath);
const transformed = transformMigrationBundle(bundle);

await writeJson(outputPath, transformed);
process.stdout.write(`Wrote Convex migration transform to ${outputPath}\n`);
