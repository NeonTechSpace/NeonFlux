import type { HistoryState } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import {
    readDashboardGuildPreview,
    readDashboardGuildSourcePreview,
    withoutDashboardGuildTransitionPreviews,
    withDashboardGuildPreview,
} from './dashboard-guild-preview.js';

describe('dashboard guild transition previews', () => {
    it('keeps the source server distinct from the pending target', () => {
        const state = withDashboardGuildPreview(
            { id: 'guild-2', name: 'Target Guild', mode: 'multi' },
            { id: 'guild-1', name: 'Current Guild', mode: 'multi' }
        )({ __tempKey: 'test' });

        expect(readDashboardGuildPreview(state, 'guild-2')).toEqual({
            id: 'guild-2',
            name: 'Target Guild',
            mode: 'multi',
        });
        expect(readDashboardGuildSourcePreview(state, 'guild-2')).toEqual({
            id: 'guild-1',
            name: 'Current Guild',
            mode: 'multi',
        });
    });

    it('does not reuse a stale or target-equal source preview', () => {
        const staleState = withDashboardGuildPreview(
            { id: 'guild-2', name: 'Target Guild', mode: 'multi' },
            { id: 'guild-1', name: 'Current Guild', mode: 'multi' }
        )({ __tempKey: 'test' });
        const sourceClearedState = withDashboardGuildPreview({
            id: 'guild-3',
            name: 'Next Guild',
            mode: 'multi',
        })(staleState);
        const targetEqualSourceState = withDashboardGuildPreview(
            { id: 'guild-4', name: 'Same Guild', mode: 'multi' },
            { id: 'guild-4', name: 'Same Guild', mode: 'multi' }
        )({ __tempKey: 'test' });

        expect(readDashboardGuildSourcePreview(sourceClearedState, 'guild-3')).toBeUndefined();
        expect(readDashboardGuildSourcePreview(targetEqualSourceState, 'guild-4')).toBeUndefined();
        expect(readDashboardGuildSourcePreview(staleState, 'guild-9')).toBeUndefined();
    });

    it('removes transition-only previews after route data commits', () => {
        const state = withDashboardGuildPreview(
            { id: 'guild-2', name: 'Target Guild', mode: 'multi' },
            { id: 'guild-1', name: 'Current Guild', mode: 'multi' }
        )({ __tempKey: 'test', persistent: 'keep-me' } as HistoryState & { persistent: string });

        expect(withoutDashboardGuildTransitionPreviews(state)).toEqual({
            __tempKey: 'test',
            persistent: 'keep-me',
        });
        expect(withoutDashboardGuildTransitionPreviews({ persistent: 'keep-me' })).toBeUndefined();
    });
});
