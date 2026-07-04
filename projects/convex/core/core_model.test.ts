import { describe, expect, it } from 'vitest';

import {
    buildDeploymentConfigDocument,
    deploymentConfigId,
    normalizeDeploymentConfigInput,
    normalizeListLimit,
    normalizeRequiredId,
} from './core_model.js';

describe('Convex core model helpers', () => {
    it('normalizes single-mode deployment config to the app-facing contract', () => {
        expect(
            normalizeDeploymentConfigInput({
                instanceMode: ' single ',
                ownerIds: [' owner-a ', '', 'owner-b'],
                publicWebUrl: ' https://neonflux.example ',
                singleGuildId: ' guild-1 ',
            })
        ).toEqual({
            ok: true,
            value: {
                instanceMode: 'single',
                ownerIds: ['owner-a', 'owner-b'],
                publicWebUrl: 'https://neonflux.example',
                singleGuildId: 'guild-1',
            },
        });
    });

    it('drops single guild id and blank public URL for multi-mode deployment config', () => {
        expect(
            buildDeploymentConfigDocument(
                {
                    instanceMode: 'multi',
                    publicWebUrl: '  ',
                    singleGuildId: 'ignored',
                },
                '2026-07-03T08:00:00.000Z',
                '2026-07-03T07:00:00.000Z'
            )
        ).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-03T07:00:00.000Z',
                id: deploymentConfigId,
                instanceMode: 'multi',
                ownerIds: [],
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('rejects deployment config without a valid instance mode', () => {
        expect(normalizeDeploymentConfigInput({ instanceMode: '  ' })).toEqual({
            error: 'missing-instance-mode',
            ok: false,
        });
        expect(normalizeDeploymentConfigInput({ instanceMode: 'staging' })).toEqual({
            error: 'invalid-instance-mode',
            ok: false,
        });
    });

    it('requires a single guild id for single-mode deployment config', () => {
        expect(normalizeDeploymentConfigInput({ instanceMode: 'single', singleGuildId: '  ' })).toEqual({
            error: 'missing-single-guild-id',
            ok: false,
        });
    });

    it('normalizes required guild ids', () => {
        expect(normalizeRequiredId(' guild-1 ', 'missing-guild-id')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredId('   ', 'missing-guild-id')).toEqual({ error: 'missing-guild-id', ok: false });
    });

    it('bounds list limits', () => {
        expect(normalizeListLimit(undefined)).toBe(1000);
        expect(normalizeListLimit(0)).toBe(1);
        expect(normalizeListLimit(3.8)).toBe(3);
        expect(normalizeListLimit(50_000)).toBe(5000);
    });
});
