import type { RefObject } from 'react';
import { useEffect } from 'react';

import type {
    DashboardBlueprintExplorerModel,
    DashboardBlueprintExplorerPathMetadata,
} from './dashboard-blueprint-explorer-model.js';

export function buildDashboardBlueprintChannelTypeCss(explorerModel: DashboardBlueprintExplorerModel): string {
    const channelPathsByType = new Map<0 | 2 | 998 | 'unknown', string[]>();

    for (const [path, metadata] of explorerModel.pathMetadata) {
        if (metadata.kind !== 'channel') continue;

        const channelType = readChannelType(metadata.item);
        const type = channelType === 0 || channelType === 2 || channelType === 998 ? channelType : 'unknown';
        const paths = channelPathsByType.get(type) ?? [];
        paths.push(path);
        channelPathsByType.set(type, paths);
    }

    const allChannelPaths = [...channelPathsByType.values()].flat();
    if (allChannelPaths.length === 0) return '';

    return `
        ${channelIconSelectors(allChannelPaths, ' svg')} {
            display: none;
        }
        ${channelIconSelectors(channelPathsByType.get(0) ?? [], '::before')} {
            content: '#';
            font-size: 0.875rem;
            font-weight: 700;
            line-height: 1;
        }
        ${channelIconSelectors(channelPathsByType.get(2) ?? [], '::before')} {
            content: '';
            width: 0.875rem;
            height: 0.875rem;
            background-color: currentColor;
            -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M11 5 6 9H2v6h4l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12'/%3E%3C/svg%3E") center / contain no-repeat;
            mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M11 5 6 9H2v6h4l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12'/%3E%3C/svg%3E") center / contain no-repeat;
        }
        ${channelIconSelectors(channelPathsByType.get(998) ?? [], '::before')} {
            content: '';
            width: 0.875rem;
            height: 0.875rem;
            background-color: currentColor;
            -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M15 3h6v6m0-6-9 9m-2-7H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5'/%3E%3C/svg%3E") center / contain no-repeat;
            mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M15 3h6v6m0-6-9 9m-2-7H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5'/%3E%3C/svg%3E") center / contain no-repeat;
        }
        ${channelIconSelectors(channelPathsByType.get('unknown') ?? [], '::before')} {
            content: '?';
            box-sizing: border-box;
            width: 0.875rem;
            height: 0.875rem;
            border: 1px solid currentColor;
            border-radius: 999px;
            font-size: 0.625rem;
            font-weight: 700;
            line-height: 0.75rem;
            text-align: center;
        }
    `;
}

export function useDashboardBlueprintChannelTypeAccessibilityLabels(
    treeContainerRef: RefObject<HTMLDivElement | null>,
    explorerModel: DashboardBlueprintExplorerModel
): void {
    useEffect(() => {
        const host = treeContainerRef.current?.querySelector<HTMLElement>('[data-blueprint-structure-tree]');
        const treeRoot = host?.shadowRoot ?? host;
        if (!treeRoot) return;

        const updateLabels = () => {
            for (const row of treeRoot.querySelectorAll<HTMLElement>("button[data-type='item'][data-item-path]")) {
                const path = row.dataset.itemPath;
                const metadata = path ? explorerModel.pathMetadata.get(path) : undefined;
                if (metadata?.kind !== 'channel') continue;

                const typeLabel = formatDashboardBlueprintChannelType(readChannelType(metadata.item));
                row.setAttribute('aria-label', `${path}, ${typeLabel.replace(/ \((?:0|2|4|998)\)$/, '')} channel`);
                row.setAttribute('title', `${metadata.label} — ${typeLabel} channel`);
            }
        };

        updateLabels();
        const observer = new MutationObserver(updateLabels);
        observer.observe(treeRoot, {
            attributeFilter: ['data-item-path'],
            attributes: true,
            childList: true,
            subtree: true,
        });

        return () => observer.disconnect();
    }, [explorerModel, treeContainerRef]);
}

export function formatDashboardBlueprintChannelType(value: unknown): string {
    if (value === 0) return 'Text (0)';
    if (value === 2) return 'Voice (2)';
    if (value === 4) return 'Category (4)';
    if (value === 998) return 'Link (998)';

    return typeof value === 'number' ? `Unknown (${String(value)})` : 'Unknown';
}

function channelIconSelectors(paths: string[], suffix = ''): string {
    if (paths.length === 0) return ':not(*)';

    return paths
        .map(
            (path) =>
                `button[data-type='item'][data-item-path=${JSON.stringify(path)}] > [data-item-section='icon']${suffix}`
        )
        .join(',\n');
}

function readChannelType(item: DashboardBlueprintExplorerPathMetadata['item']): number | undefined {
    if (!item || !('type' in item) || typeof item.type !== 'number') return undefined;
    return item.type;
}
