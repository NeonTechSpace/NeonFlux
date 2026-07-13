import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS } from '@neonflux/fluxer/guild-structure-snapshot';

import {
    validateDashboardStructureExecutionControlInput,
    validateDashboardStructurePlanInput,
} from './dashboard-structure-route-data.js';

vi.mock('@tanstack/react-start', () => ({
    createServerFn: vi.fn(() => ({
        validator: vi.fn(() => ({ handler: vi.fn() })),
    })),
}));

describe('dashboard structure route validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(['pause', 'resume', 'cancel'] as const)('preserves the supported %s execution request', (request) => {
        expect(
            validateDashboardStructureExecutionControlInput({
                guildId: 'guild-1',
                runId: 'run-1',
                executionId: 'execution-1',
                request,
            })
        ).toStrictEqual({
            guildId: 'guild-1',
            runId: 'run-1',
            executionId: 'execution-1',
            request,
        });
    });

    it.each([undefined, '', 'restart', 1])('rejects an unknown execution request discriminator', (request) => {
        expect(() =>
            validateDashboardStructureExecutionControlInput({
                guildId: 'guild-1',
                runId: 'run-1',
                executionId: 'execution-1',
                request,
            })
        ).toThrow('Execution control request must be pause, resume, or cancel.');
    });

    it('rejects an oversized multibyte blueprint at the route boundary', () => {
        const backupJson = 'é'.repeat(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes / 2 + 1);

        expect(() => validateDashboardStructurePlanInput({ guildId: 'guild-1', backupJson, policy: 'merge' })).toThrow(
            'Server blueprint JSON cannot exceed 4 MiB.'
        );
    });
});
