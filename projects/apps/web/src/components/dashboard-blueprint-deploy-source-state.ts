import { BLUEPRINT_SNAPSHOT_LIMITS, isBlueprintSnapshotJsonWithinByteLimit } from '@neonflux/blueprint/snapshot';

import { readDashboardBlueprintSourceSnapshot } from './dashboard-blueprint-deploy-stage.js';

export type DashboardBlueprintSourceState =
    | { status: 'empty'; mode: 'file' | 'paste' }
    | { status: 'reading'; mode: 'file'; fileName: string }
    | { status: 'invalid'; mode: 'file' | 'paste'; message: string }
    | {
          status: 'ready';
          mode: 'file' | 'paste';
          json: string;
          file?: { name: string; size: number };
      };

export async function readDashboardBlueprintSourceFiles(
    files: readonly File[]
): Promise<Exclude<DashboardBlueprintSourceState, { status: 'reading' }>> {
    if (files.length === 0) return { status: 'empty', mode: 'file' };
    if (files.length > 1) {
        return { status: 'invalid', mode: 'file', message: 'Choose one JSON file at a time.' };
    }
    const file = files[0];
    if (file.size > BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes) {
        return { status: 'invalid', mode: 'file', message: 'Choose a JSON file up to 4 MiB.' };
    }

    try {
        const json = await file.text();
        if (!isBlueprintSnapshotJsonWithinByteLimit(json) || !readDashboardBlueprintSourceSnapshot(json)) {
            return { status: 'invalid', mode: 'file', message: 'This file is not valid Blueprint JSON.' };
        }
        return { status: 'ready', mode: 'file', json, file: { name: file.name, size: file.size } };
    } catch {
        return {
            status: 'invalid',
            mode: 'file',
            message: 'This file could not be read. Choose it again or use Paste JSON.',
        };
    }
}
