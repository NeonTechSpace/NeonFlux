import type { HistoryState } from '@tanstack/react-router';

export type DashboardGuildPreview = {
    id: string;
    name: string;
    iconUrl?: string;
    mode: 'single' | 'multi';
};

const dashboardGuildPreviewStateKey = 'dashboardGuildPreview';

declare module '@tanstack/react-router' {
    interface HistoryState {
        dashboardGuildPreview?: DashboardGuildPreview;
    }
}

export function createDashboardGuildPreview(input: DashboardGuildPreview): DashboardGuildPreview {
    return {
        id: input.id,
        name: input.name,
        ...(input.iconUrl ? { iconUrl: input.iconUrl } : {}),
        mode: input.mode,
    };
}

export function withDashboardGuildPreview(preview: DashboardGuildPreview) {
    return (state: HistoryState): HistoryState => ({
        ...state,
        __tempKey: state.__tempKey,
        dashboardGuildPreview: createDashboardGuildPreview(preview),
    });
}

export function readDashboardGuildPreview(state: unknown, guildId: string): DashboardGuildPreview | undefined {
    if (!state || typeof state !== 'object') {
        return undefined;
    }

    const preview = (state as Record<string, unknown>)[dashboardGuildPreviewStateKey];

    if (!preview || typeof preview !== 'object') {
        return undefined;
    }

    const previewRecord = preview as Record<string, unknown>;
    const id = previewRecord.id;
    const name = previewRecord.name;
    const iconUrl = previewRecord.iconUrl;
    const mode = previewRecord.mode;

    if (id !== guildId || typeof id !== 'string' || typeof name !== 'string') {
        return undefined;
    }

    if (mode !== 'single' && mode !== 'multi') {
        return undefined;
    }

    if (iconUrl !== undefined && typeof iconUrl !== 'string') {
        return undefined;
    }

    return {
        id,
        name,
        ...(iconUrl ? { iconUrl } : {}),
        mode,
    };
}
