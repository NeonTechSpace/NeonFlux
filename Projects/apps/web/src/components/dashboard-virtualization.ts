export type DashboardVirtualOverscanInput = {
    viewportSize: number;
    itemSize: number;
    min?: number;
    max?: number;
    ratio?: number;
};

const defaultMinOverscan = 2;
const defaultMaxOverscan = 12;
const defaultOverscanRatio = 0.5;

export function getDashboardVirtualVisibleCount(
    input: Pick<DashboardVirtualOverscanInput, 'viewportSize' | 'itemSize'>
): number {
    if (input.viewportSize <= 0 || input.itemSize <= 0) {
        return 1;
    }

    return Math.max(1, Math.ceil(input.viewportSize / input.itemSize));
}

export function getDashboardVirtualOverscan(input: DashboardVirtualOverscanInput): number {
    const visibleCount = getDashboardVirtualVisibleCount(input);
    const min = input.min ?? defaultMinOverscan;
    const max = input.max ?? defaultMaxOverscan;
    const ratio = input.ratio ?? defaultOverscanRatio;
    const overscan = Math.ceil(visibleCount * ratio);

    return Math.min(max, Math.max(min, overscan));
}

export function getDashboardVirtualFallbackCount(input: DashboardVirtualOverscanInput): number {
    const visibleCount = getDashboardVirtualVisibleCount(input);
    const overscan = getDashboardVirtualOverscan(input);

    return visibleCount + overscan * 2;
}
