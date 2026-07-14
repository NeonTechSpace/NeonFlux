import { parseDiffFromFile } from '@pierre/diffs';
import type { FileDiffMetadata } from '@pierre/diffs';

export { formatDashboardBlueprintExplorerSnapshotJson } from './dashboard-blueprint-explorer-json.js';

const dashboardBlueprintExplorerDiffInlineCharLimit = 250_000;

export type DashboardBlueprintExplorerJsonDiff = {
    afterLabel: string;
    beforeLabel: string;
} & (
    | {
          fileDiff: FileDiffMetadata;
          type: 'diff';
      }
    | {
          afterLength: number;
          beforeLength: number;
          limit: number;
          type: 'capped';
      }
    | {
          type: 'same';
      }
);

export function buildDashboardBlueprintExplorerJsonDiff({
    after,
    afterLabel,
    before,
    beforeLabel,
    limit = dashboardBlueprintExplorerDiffInlineCharLimit,
}: {
    after: string;
    afterLabel: string;
    before: string;
    beforeLabel: string;
    limit?: number;
}): DashboardBlueprintExplorerJsonDiff {
    if (before === after) {
        return {
            afterLabel,
            beforeLabel,
            type: 'same',
        };
    }

    if (before.length + after.length > limit) {
        return {
            afterLabel,
            afterLength: after.length,
            beforeLabel,
            beforeLength: before.length,
            limit,
            type: 'capped',
        };
    }

    return {
        afterLabel,
        beforeLabel,
        fileDiff: parseDiffFromFile(
            {
                cacheKey: `server-blueprint-before:${hashString(before)}:${beforeLabel}`,
                contents: before,
                lang: 'json',
                name: toJsonFileName(beforeLabel),
            },
            {
                cacheKey: `server-blueprint-after:${hashString(after)}:${afterLabel}`,
                contents: after,
                lang: 'json',
                name: toJsonFileName(afterLabel),
            },
            undefined,
            true
        ),
        type: 'diff',
    };
}

function toJsonFileName(label: string): string {
    const sanitized = label
        .replace(/[^\w .-]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const baseName = sanitized || 'Server Blueprint';

    return baseName.toLowerCase().endsWith('.json') ? baseName : `${baseName}.json`;
}

function hashString(value: string): string {
    let hash = 0;

    for (let index = 0; index < value.length; index += 1) {
        hash = Math.imul(31, hash) + value.charCodeAt(index);
        hash |= 0;
    }

    return `${value.length}:${hash.toString(36)}`;
}
