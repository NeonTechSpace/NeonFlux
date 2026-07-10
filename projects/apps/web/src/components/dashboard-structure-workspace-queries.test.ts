import { describe, expect, it, vi } from 'vitest';

import { recoverDashboardStructureSettings } from './dashboard-structure-workspace-queries.js';

describe('Server Blueprint settings recovery', () => {
    it('reloads instead of accumulating another read when the timed-out request is still outstanding', () => {
        const refetch = vi.fn();
        const reload = vi.fn();

        recoverDashboardStructureSettings({ requestOutstanding: true, refetch, reload });

        expect(reload).toHaveBeenCalledOnce();
        expect(refetch).not.toHaveBeenCalled();
    });

    it('refetches normally after the previous request settled', () => {
        const refetch = vi.fn();
        const reload = vi.fn();

        recoverDashboardStructureSettings({ requestOutstanding: false, refetch, reload });

        expect(refetch).toHaveBeenCalledOnce();
        expect(reload).not.toHaveBeenCalled();
    });
});
