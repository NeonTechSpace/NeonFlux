import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const staticImportPattern = /(?:from|import)["']\.\/([^"']+\.js)["']/gu;

/** @typedef {Map<string, string>} ChunkMap */

/**
 * @param {ChunkMap} chunks
 * @param {string} entry
 */
export function collectStaticClosure(chunks, entry) {
    const visited = new Set();
    const pending = [entry];

    while (pending.length > 0) {
        const current = pending.pop();
        if (!current || visited.has(current)) continue;
        visited.add(current);

        const code = chunks.get(current);
        if (code === undefined) throw new Error(`Dashboard bundle guard could not read ${current}.`);
        for (const match of code.matchAll(staticImportPattern)) {
            const importedChunk = match[1];
            if (importedChunk) pending.push(importedChunk);
        }
    }

    return visited;
}

/**
 * @param {{
 *   chunks: ChunkMap;
 *   entry: string;
 *   label: string;
 *   forbidden: string[];
 *   forbiddenChunkPatterns?: RegExp[];
 *   maxEntryBytes: number;
 * }} boundary
 */
export function assertBundleBoundary({ chunks, entry, label, forbidden, forbiddenChunkPatterns = [], maxEntryBytes }) {
    const closure = collectStaticClosure(chunks, entry);
    const entryBytes = Buffer.byteLength(chunks.get(entry) ?? '');
    if (entryBytes > maxEntryBytes) {
        throw new Error(`${label} entry grew to ${entryBytes} bytes (accepted ceiling: ${maxEntryBytes}).`);
    }

    for (const chunkName of closure) {
        for (const pattern of forbiddenChunkPatterns) {
            if (pattern.test(chunkName)) {
                throw new Error(`${label} statically reaches forbidden chunk ${chunkName}.`);
            }
        }
        const code = chunks.get(chunkName) ?? '';
        for (const marker of forbidden) {
            if (code.includes(marker)) {
                throw new Error(
                    `${label} statically reaches forbidden leaf marker ${JSON.stringify(marker)} via ${chunkName}.`
                );
            }
        }
    }
}

/** @param {ChunkMap} chunks */
export function assertProductionClientArtifacts(chunks) {
    for (const [chunkName, code] of chunks) {
        if (
            /^jsx-dev-runtime-[\w-]+\.js$/u.test(chunkName) ||
            code.includes('react/jsx-dev-runtime') ||
            /\bjsxDEV\(/u.test(code)
        ) {
            throw new Error(`Production client artifact ${chunkName} contains React development JSX output.`);
        }

        if (code.replaceAll('\\', '/').includes('/apps/web/src/')) {
            throw new Error(
                `Production client artifact ${chunkName} contains an absolute apps/web/src workspace path.`
            );
        }
    }
}

/** @param {string} assetsDirectory */
export async function checkDashboardBundleBoundaries(assetsDirectory) {
    const chunks = new Map();
    for (const name of await readdir(assetsDirectory)) {
        if (!name.endsWith('.js')) continue;
        chunks.set(name, await readFile(join(assetsDirectory, name), 'utf8'));
    }

    assertProductionClientArtifacts(chunks);

    const guildEntries = findChunks(chunks, /^dashboard\._guildId-[\w-]+\.js$/u, 'guild shell');
    const shippedLeafEntries = {
        overview: findSingleChunk(chunks, /^_guildId-[\w-]+\.js$/u, 'Overview leaf', 'Listening for activity'),
        commandPrefix: findSingleChunk(chunks, /^command-prefix-[\w-]+\.js$/u, 'Command Prefix leaf', 'New prefix'),
        auditEvents: findSingleChunk(chunks, /^audit-events-[\w-]+\.js$/u, 'Audit Events leaf', 'Audit event explorer'),
        messageBuilder: findSingleChunk(
            chunks,
            /^message-builder-[\w-]+\.js$/u,
            'Message Builder leaf',
            'Queue message'
        ),
    };
    const overviewChartsEntry = findSingleChunk(
        chunks,
        /^dashboard-server-overview-charts-[\w-]+\.js$/u,
        'Overview charts tool'
    );
    const blueprintEntry = findSingleChunk(
        chunks,
        /^structure-[\w-]+\.js$/u,
        'Blueprint runtime',
        'BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE'
    );
    const leafEntries = {
        current: findSingleChunk(chunks, /^current-[\w-]+\.js$/u, 'Blueprint Overview leaf'),
        backups: findSingleChunk(chunks, /^backups-[\w-]+\.js$/u, 'Blueprint Backups leaf'),
        compare: findSingleChunk(chunks, /^compare-[\w-]+\.js$/u, 'Blueprint Compare leaf'),
        deploy: findSingleChunk(chunks, /^deploy-[\w-]+\.js$/u, 'Blueprint Deploy leaf'),
        runs: findSingleChunk(chunks, /^runs-[\w-]+\.js$/u, 'Blueprint Runs leaf'),
    };

    for (const guildEntry of guildEntries) {
        assertBundleBoundary({
            chunks,
            entry: guildEntry,
            label: 'Guild shell',
            maxEntryBytes: 12_000,
            forbidden: [
                'Queue message',
                'Audit event explorer',
                'New prefix',
                'Listening for activity',
                'recharts-surface',
            ],
        });
    }
    assertBundleBoundary({
        chunks,
        entry: blueprintEntry,
        label: 'Blueprint runtime',
        maxEntryBytes: 30_000,
        forbidden: [
            'Start with one protected version',
            'Schedule and retention',
            'Deployment stages',
            'Open run',
            'recharts-surface',
        ],
    });

    const optionalToolChunks = [
        /^dashboard-structure-explorer-(?!snapshot-|json-|types-|model-|diff-|details-|channel-types-)[\w-]+\.js$/u,
        /^dashboard-structure-deploy-review-[\w-]+\.js$/u,
    ];
    const leafBoundaries = [
        {
            entry: leafEntries.current,
            label: 'Blueprint Overview leaf',
            maxEntryBytes: 30_000,
            forbidden: ['Schedule and retention', 'Deployment stages', 'Open run'],
        },
        {
            entry: leafEntries.backups,
            label: 'Blueprint Backups leaf',
            maxEntryBytes: 300_000,
            forbidden: ['Inspect live layout', 'Deployment stages', 'Open run'],
        },
        {
            entry: leafEntries.compare,
            label: 'Blueprint Compare leaf',
            maxEntryBytes: 50_000,
            forbidden: ['Schedule and retention', 'Deployment stages', 'Open run'],
        },
        {
            entry: leafEntries.deploy,
            label: 'Blueprint Deploy leaf',
            maxEntryBytes: 50_000,
            forbidden: ['Schedule and retention', 'Open run'],
        },
        {
            entry: leafEntries.runs,
            label: 'Blueprint Runs leaf',
            maxEntryBytes: 25_000,
            forbidden: ['Schedule and retention', 'Deployment stages'],
        },
    ];
    for (const boundary of leafBoundaries) {
        assertBundleBoundary({ ...boundary, chunks, forbiddenChunkPatterns: optionalToolChunks });
    }

    const shippedLeafBoundaries = [
        {
            entry: shippedLeafEntries.overview,
            label: 'Overview leaf',
            maxEntryBytes: 16_000,
            forbidden: ['New prefix', 'Audit event explorer', 'Queue message'],
            forbiddenChunkPatterns: [/^dashboard-server-overview-charts-[\w-]+\.js$/u],
        },
        {
            entry: shippedLeafEntries.commandPrefix,
            label: 'Command Prefix leaf',
            maxEntryBytes: 26_000,
            forbidden: ['Listening for activity', 'Audit event explorer', 'Queue message', 'recharts-surface'],
        },
        {
            entry: shippedLeafEntries.auditEvents,
            label: 'Audit Events leaf',
            maxEntryBytes: 30_000,
            forbidden: ['Listening for activity', 'New prefix', 'Queue message', 'recharts-surface'],
        },
        {
            entry: shippedLeafEntries.messageBuilder,
            label: 'Message Builder leaf',
            maxEntryBytes: 60_000,
            forbidden: ['Listening for activity', 'New prefix', 'Audit event explorer', 'recharts-surface'],
        },
    ];
    for (const boundary of shippedLeafBoundaries) {
        assertBundleBoundary({ ...boundary, chunks });
    }
    assertBundleBoundary({
        chunks,
        entry: overviewChartsEntry,
        label: 'Overview charts tool',
        maxEntryBytes: 410_000,
        forbidden: ['New prefix', 'Audit event explorer', 'Queue message'],
    });

    return { blueprintEntry, guildEntries, leafEntries, overviewChartsEntry, shippedLeafEntries };
}

/**
 * @param {ChunkMap} chunks
 * @param {RegExp} pattern
 * @param {string} label
 * @param {string | undefined} [requiredMarker]
 */
function findSingleChunk(chunks, pattern, label, requiredMarker) {
    const matches = [...chunks.keys()].filter(
        (name) => pattern.test(name) && (!requiredMarker || chunks.get(name)?.includes(requiredMarker))
    );
    const [match] = matches;
    if (matches.length !== 1 || !match) {
        throw new Error(`Dashboard bundle guard expected one ${label} chunk, found ${matches.length}.`);
    }
    return match;
}

/**
 * @param {ChunkMap} chunks
 * @param {RegExp} pattern
 * @param {string} label
 */
function findChunks(chunks, pattern, label) {
    const matches = [...chunks.keys()].filter((name) => pattern.test(name));
    if (matches.length === 0) throw new Error(`Dashboard bundle guard expected at least one ${label} chunk.`);
    return matches;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
    const argumentIndex = process.argv.indexOf('--assets');
    const assetsArgument = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined;
    const assetsDirectory = resolve(assetsArgument ?? 'apps/web/.output/public/assets');
    const assetsState = await stat(assetsDirectory).catch(() => undefined);
    if (!assetsState?.isDirectory()) throw new Error(`Dashboard bundle assets do not exist at ${assetsDirectory}.`);

    const result = await checkDashboardBundleBoundaries(assetsDirectory);
    console.log(
        `Dashboard bundle boundaries verified: ${[
            ...result.guildEntries,
            result.blueprintEntry,
            ...Object.values(result.shippedLeafEntries),
            result.overviewChartsEntry,
            ...Object.values(result.leafEntries),
        ]
            .map((entry) => basename(entry))
            .join(', ')}.`
    );
}
