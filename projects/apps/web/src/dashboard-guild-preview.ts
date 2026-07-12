import type { HistoryState } from '@tanstack/react-router';

export type DashboardGuildPreview = {
    id: string;
    name: string;
    iconUrl?: string;
    mode: 'single' | 'multi';
};

const dashboardGuildPreviewStateKey = 'dashboardGuildPreview';
const dashboardGuildSourcePreviewStateKey = 'dashboardGuildSourcePreview';

declare module '@tanstack/react-router' {
    interface HistoryState {
        dashboardGuildPreview?: DashboardGuildPreview;
        dashboardGuildSourcePreview?: DashboardGuildPreview;
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

export function withDashboardGuildPreview(preview: DashboardGuildPreview, sourcePreview?: DashboardGuildPreview) {
    return (state: HistoryState): HistoryState => ({
        ...state,
        __tempKey: state.__tempKey,
        dashboardGuildPreview: createDashboardGuildPreview(preview),
        dashboardGuildSourcePreview: sourcePreview ? createDashboardGuildPreview(sourcePreview) : undefined,
    });
}

export function readDashboardGuildPreview(state: unknown, guildId: string): DashboardGuildPreview | undefined {
    const preview = readDashboardGuildPreviewState(state, dashboardGuildPreviewStateKey);

    return preview?.id === guildId ? preview : undefined;
}

export function readDashboardGuildSourcePreview(
    state: unknown,
    targetGuildId: string
): DashboardGuildPreview | undefined {
    if (!readDashboardGuildPreview(state, targetGuildId)) {
        return undefined;
    }

    const sourcePreview = readDashboardGuildPreviewState(state, dashboardGuildSourcePreviewStateKey);

    return sourcePreview?.id === targetGuildId ? undefined : sourcePreview;
}

export function withoutDashboardGuildTransitionPreviews(state: unknown): HistoryState | undefined {
    if (!state || typeof state !== 'object') {
        return undefined;
    }

    const stateRecord = state as Record<string, unknown>;
    if (!(dashboardGuildPreviewStateKey in stateRecord) && !(dashboardGuildSourcePreviewStateKey in stateRecord)) {
        return undefined;
    }

    const nextState = { ...stateRecord };
    delete nextState[dashboardGuildPreviewStateKey];
    delete nextState[dashboardGuildSourcePreviewStateKey];

    return nextState;
}

function readDashboardGuildPreviewState(state: unknown, key: string): DashboardGuildPreview | undefined {
    if (!state || typeof state !== 'object') {
        return undefined;
    }

    const preview = (state as Record<string, unknown>)[key];

    if (!preview || typeof preview !== 'object') {
        return undefined;
    }

    const previewRecord = preview as Record<string, unknown>;
    const id = previewRecord.id;
    const name = previewRecord.name;
    const iconUrl = previewRecord.iconUrl;
    const mode = previewRecord.mode;

    if (typeof id !== 'string' || typeof name !== 'string') {
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
