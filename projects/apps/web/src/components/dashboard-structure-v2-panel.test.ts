import { describe, expect, it } from 'vitest';

import {
    dashboardStructureExecutionPhases,
    formatDashboardStructureExecutionPhase,
    getDashboardStructureDeleteApprovalText,
} from '../server/dashboard-structure-v2.js';
import { dashboardStructureDeploymentPolicies } from './dashboard-structure-panel-view.js';

describe('Server Blueprint v2 panel contracts', () => {
    it('offers exactly the three canonical deployment policies', () => {
        expect(dashboardStructureDeploymentPolicies.map(({ value, label }) => ({ value, label }))).toEqual([
            { value: 'merge', label: 'Merge additions only' },
            { value: 'synchronize', label: 'Match blueprint (recommended)' },
            { value: 'rebuild', label: 'Reset and rebuild' },
        ]);
    });

    it('binds destructive confirmation to run, count, and delete manifest', () => {
        expect(getDashboardStructureDeleteApprovalText('run-7', 12, 'abcdef0123456789')).toBe(
            'DELETE run-7 12 abcdef012345'
        );
    });

    it('keeps every persisted execution phase visible instead of collapsing it to queued', () => {
        expect(dashboardStructureExecutionPhases).toEqual([
            'queued',
            'preparing',
            'create',
            'update',
            'delete',
            'channel_order',
            'role_order',
            'waiting_rate_limit',
            'paused',
            'verifying',
            'complete',
        ]);
        expect(formatDashboardStructureExecutionPhase('waiting_rate_limit')).toBe('Waiting for Fluxer rate limit');
        expect(formatDashboardStructureExecutionPhase('verifying')).toBe('Verifying final layout');
    });
});
