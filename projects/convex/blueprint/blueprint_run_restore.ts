import { canonicalJsonStringify } from '@neonflux/blueprint/canonical-json';
import type { BlueprintMutationFenceManifestV2 } from '@neonflux/blueprint/mutation-fence';

export function assertBlueprintRunRestoreObservationManifest(input: {
    expectedManifest?: BlueprintMutationFenceManifestV2;
    guildId: string;
    manifest: BlueprintMutationFenceManifestV2;
    observationCapabilityFingerprint: string;
    observationStructureFingerprint: string;
}): void {
    if (
        input.manifest.guildId !== input.guildId ||
        input.manifest.structureDigest !== input.observationStructureFingerprint ||
        input.manifest.capabilityDigest !== input.observationCapabilityFingerprint ||
        (input.expectedManifest !== undefined &&
            canonicalJsonStringify(input.manifest) !== canonicalJsonStringify(input.expectedManifest))
    ) {
        throw new Error('blueprint-run-restore-observation-invalid');
    }
}
