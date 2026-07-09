import { pathToFileURL } from 'node:url';

import { api } from '../convex/_generated/api.js';
import { loadLocalEnv, loadRuntimeConfig, requireConvexConfig } from '../packages/config/src/env.js';
import { createConvexServiceDb } from '../packages/db/src/convex.js';

type BackfillAuditSortKeysArgs = {
    confirmProductionBackfill: boolean;
    limit: number;
};

const defaultBatchLimit = 100;
const maxBatchLimit = 500;
const productionDeploymentRefs = new Set(['prod', 'production']);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    loadLocalEnv();

    const args = parseBackfillAuditSortKeysArgs(process.argv.slice(2));
    const config = requireConvexConfig();
    const runtimeConfig = loadRuntimeConfig();

    if (isProductionTarget(config.deployment, runtimeConfig.appEnv) && !args.confirmProductionBackfill) {
        throw new Error(
            'Refusing to backfill production audit sort keys without --confirm-production-backfill. This patches existing audit event documents.'
        );
    }

    const database = await createConvexServiceDb(config, { serviceName: 'web' });
    let totalPatched = 0;
    let batches = 0;
    let shouldContinue = true;

    try {
        while (shouldContinue) {
            const result = await database.client.mutation(api.events.backfillBotActionEventSortKeys, {
                limit: args.limit,
            });

            batches += 1;
            totalPatched += result.patchedCount;
            process.stdout.write(
                `Patched ${String(result.patchedCount)} audit event sort keys in batch ${String(batches)}.\n`
            );

            shouldContinue = result.hasMore || result.patchedCount > 0;
        }
    } finally {
        await database.close();
    }

    process.stdout.write(
        `Audit event sort key backfill complete for ${config.deployment}. Patched ${String(totalPatched)} total rows.\n`
    );
}

export function parseBackfillAuditSortKeysArgs(argv: readonly string[]): BackfillAuditSortKeysArgs {
    let confirmProductionBackfill = false;
    let limit = defaultBatchLimit;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--') {
            continue;
        }

        if (arg === '--confirm-production-backfill') {
            confirmProductionBackfill = true;
            continue;
        }

        if (arg === '--limit') {
            const value = argv[index + 1];
            if (!value) throw new Error('--limit requires a value');
            limit = parseLimit(value);
            index += 1;
            continue;
        }

        if (arg?.startsWith('--limit=')) {
            limit = parseLimit(arg.slice('--limit='.length));
            continue;
        }

        throw new Error(`Unexpected argument: ${arg ?? ''}`);
    }

    return { confirmProductionBackfill, limit };
}

function parseLimit(value: string): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        throw new Error('--limit must be a finite number');
    }

    return Math.min(Math.max(Math.trunc(parsed), 1), maxBatchLimit);
}

function isProductionTarget(deployment: string, appEnv: string): boolean {
    return appEnv === 'production' || productionDeploymentRefs.has(deployment.toLowerCase());
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
