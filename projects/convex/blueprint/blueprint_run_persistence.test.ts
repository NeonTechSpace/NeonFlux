import { describe, expect, it } from 'vitest';
import { createBlueprintMutationFenceManifest } from '@neonflux/blueprint/mutation-fence';
import { toPortableBlueprintRestoreSnapshot, type BlueprintSnapshot } from '@neonflux/blueprint/snapshot';

import { assertBlueprintRunMetadataBounded } from './blueprint_run_persistence.js';
import { assertBlueprintRunRestoreObservationManifest } from './blueprint_run_restore.js';

describe('Blueprint hot run persistence boundary', () => {
    it('accepts compact metadata and rejects oversized fields before a database patch', () => {
        expect(() =>
            assertBlueprintRunMetadataBounded({ status: 'running', updatedAt: '2026-07-15T12:00:00Z' })
        ).not.toThrow();
        expect(() =>
            assertBlueprintRunMetadataBounded({
                errorType: 'x'.repeat(257),
                status: 'running',
                updatedAt: '2026-07-15T12:00:00Z',
            })
        ).toThrow('blueprint-run-errorType-too-large');
        expect(() =>
            assertBlueprintRunMetadataBounded({
                filler: 'x'.repeat(17 * 1024),
                status: 'running',
                updatedAt: '2026-07-15T12:00:00Z',
            })
        ).toThrow('blueprint-run-metadata-too-large');
    });
});

describe('Blueprint restore observation binding', () => {
    it('binds retries to the full observation manifest without comparing it to the portable backup', async () => {
        const snapshot: BlueprintSnapshot = {
            version: 1,
            guildId: 'guild-1',
            guildName: 'Guild',
            exportedAt: '2026-07-15T12:00:00.000Z',
            botHighestRolePosition: 2,
            botHighestRoleHierarchyRank: 0,
            roles: [
                {
                    id: 'bot-role',
                    name: 'Resident bot',
                    position: 1,
                    hierarchyRank: 0,
                    color: 0,
                    permissions: '8',
                    hoist: false,
                    mentionable: false,
                    protected: true,
                    protectionReason: 'bot',
                },
            ],
            categories: [],
            channels: [],
        };
        const fullManifest = await createBlueprintMutationFenceManifest(snapshot);
        const portableManifest = await createBlueprintMutationFenceManifest(
            toPortableBlueprintRestoreSnapshot(snapshot)
        );

        expect(portableManifest.structureDigest).not.toBe(fullManifest.structureDigest);
        expect(() =>
            assertBlueprintRunRestoreObservationManifest({
                expectedManifest: fullManifest,
                guildId: 'guild-1',
                manifest: fullManifest,
                observationCapabilityFingerprint: fullManifest.capabilityDigest,
                observationStructureFingerprint: fullManifest.structureDigest,
            })
        ).not.toThrow();
        expect(() =>
            assertBlueprintRunRestoreObservationManifest({
                expectedManifest: portableManifest,
                guildId: 'guild-1',
                manifest: fullManifest,
                observationCapabilityFingerprint: fullManifest.capabilityDigest,
                observationStructureFingerprint: fullManifest.structureDigest,
            })
        ).toThrow('blueprint-run-restore-observation-invalid');
    });
});
