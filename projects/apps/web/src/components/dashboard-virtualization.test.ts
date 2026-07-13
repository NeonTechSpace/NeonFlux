import { describe, expect, it } from 'vitest';

import {
    getDashboardVirtualFallbackCount,
    getDashboardVirtualOverscan,
    getDashboardVirtualVisibleCount,
} from './dashboard-virtualization.js';

describe('dashboard virtualization defaults', () => {
    it('keeps overscan and fallback work bounded across small and large viewports', () => {
        expect(getDashboardVirtualVisibleCount({ viewportSize: 520, itemSize: 176 })).toBe(3);
        expect(getDashboardVirtualOverscan({ viewportSize: 520, itemSize: 176 })).toBe(2);
        expect(getDashboardVirtualOverscan({ viewportSize: 4000, itemSize: 40 })).toBe(12);
        expect(getDashboardVirtualFallbackCount({ viewportSize: 520, itemSize: 176 })).toBe(7);
    });
});
