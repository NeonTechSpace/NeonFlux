import { describe, expect, it } from 'vitest';

import {
    getDashboardVirtualFallbackCount,
    getDashboardVirtualOverscan,
    getDashboardVirtualVisibleCount,
} from './dashboard-virtualization.js';

describe('dashboard virtualization defaults', () => {
    it('estimates visible item count from viewport and item size', () => {
        expect(getDashboardVirtualVisibleCount({ viewportSize: 520, itemSize: 176 })).toBe(3);
        expect(getDashboardVirtualVisibleCount({ viewportSize: 448, itemSize: 88 })).toBe(6);
    });

    it('keeps default overscan proportional to the visible viewport and bounded', () => {
        expect(getDashboardVirtualOverscan({ viewportSize: 520, itemSize: 176 })).toBe(2);
        expect(getDashboardVirtualOverscan({ viewportSize: 960, itemSize: 48 })).toBe(10);
        expect(getDashboardVirtualOverscan({ viewportSize: 4000, itemSize: 40 })).toBe(12);
    });

    it('uses visible rows plus overscan on both sides for static fallbacks', () => {
        expect(getDashboardVirtualFallbackCount({ viewportSize: 520, itemSize: 176 })).toBe(7);
    });
});
