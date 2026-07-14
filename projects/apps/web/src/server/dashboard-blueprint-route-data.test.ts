import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BLUEPRINT_SNAPSHOT_LIMITS } from '@neonflux/blueprint/snapshot';

import {
    validateDashboardBlueprintRunControlInput,
    validateDashboardBlueprintPlanInput,
} from './dashboard-blueprint-route-data.js';

vi.mock('@tanstack/react-start', () => ({
    createServerFn: vi.fn(() => ({
        validator: vi.fn(() => ({ handler: vi.fn() })),
    })),
}));

describe('dashboard structure route validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(['pause', 'resume', 'cancel'] as const)('preserves the supported %s run request', (request) => {
        expect(
            validateDashboardBlueprintRunControlInput({
                guildId: 'guild-1',
                planId: 'run-1',
                runId: 'run-1',
                request,
            })
        ).toStrictEqual({
            guildId: 'guild-1',
            planId: 'run-1',
            runId: 'run-1',
            request,
        });
    });

    it.each([undefined, '', 'restart', 1])('rejects an unknown run request discriminator', (request) => {
        expect(() =>
            validateDashboardBlueprintRunControlInput({
                guildId: 'guild-1',
                planId: 'run-1',
                runId: 'run-1',
                request,
            })
        ).toThrow('Run control request must be pause, resume, or cancel.');
    });

    it('rejects an oversized multibyte blueprint at the route boundary', () => {
        const backupJson = 'é'.repeat(BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes / 2 + 1);

        expect(() => validateDashboardBlueprintPlanInput({ guildId: 'guild-1', backupJson, policy: 'merge' })).toThrow(
            'Server blueprint JSON cannot exceed 4 MiB.'
        );
    });
});
