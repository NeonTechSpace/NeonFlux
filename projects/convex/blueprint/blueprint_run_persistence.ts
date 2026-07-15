import { getDocumentSize, type Value } from 'convex/values';

import type { Doc } from '../_generated/dataModel.js';
import type { MutationCtx } from '../_generated/server.js';

export const MAX_BLUEPRINT_RUN_METADATA_BYTES = 16 * 1024;

export type BlueprintRunPatch = {
    [Key in keyof Omit<Doc<'blueprintRuns'>, '_id' | '_creationTime'>]?: Doc<'blueprintRuns'>[Key] | undefined;
};

export async function patchBlueprintRunChecked(
    ctx: MutationCtx,
    run: Doc<'blueprintRuns'>,
    patch: BlueprintRunPatch
): Promise<void> {
    const next = applyBlueprintRunPatch(run, patch);
    assertBlueprintRunMetadataBounded(next);
    await ctx.db.patch('blueprintRuns', run._id, patch as never);
}

export function assertBlueprintRunMetadataBounded(run: Record<string, unknown>): void {
    for (const [field, maximum] of [
        ['authorizationMismatchJson', 4 * 1024],
        ['currentStepLabel', 512],
        ['currentStepDomain', 256],
        ['currentStepId', 256],
        ['errorType', 256],
        ['leaseId', 256],
        ['leaseOwner', 256],
        ['restorePointBackupId', 256],
        ['restorePointSnapshotDigest', 64],
        ['terminalDigest', 64],
        ['terminalRequestDigest', 64],
    ] as const) {
        const value = run[field];
        if (typeof value === 'string' && new TextEncoder().encode(value).byteLength > maximum) {
            throw new Error(`blueprint-run-${field}-too-large`);
        }
    }
    if (getDocumentSize(run as Record<string, Value>) > MAX_BLUEPRINT_RUN_METADATA_BYTES) {
        throw new Error('blueprint-run-metadata-too-large');
    }
}

export function applyBlueprintRunPatch(run: Doc<'blueprintRuns'>, patch: BlueprintRunPatch): Doc<'blueprintRuns'> {
    return compactValueRecord({ ...run, ...patch }) as Doc<'blueprintRuns'>;
}

function compactValueRecord(value: Record<string, Value | undefined>): Record<string, Value> {
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, Value] => entry[1] !== undefined)
    );
}
