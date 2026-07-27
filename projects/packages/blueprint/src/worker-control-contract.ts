export const blueprintWorkerControlProtocolVersion = 1 as const;
export const blueprintWorkerControlJwtAudience = 'neonflux-bot-blueprint-control-v1';
export const blueprintWorkerWakePath = '/v1/blueprint/worker/wake';

export type BlueprintWorkerWakeResponse = {
    protocolVersion: typeof blueprintWorkerControlProtocolVersion;
    type: 'accepted';
};

export type BlueprintWorkerWakeResponseParseResult =
    | { type: 'valid'; value: BlueprintWorkerWakeResponse }
    | { type: 'invalid' };

export function parseBlueprintWorkerWakeResponse(value: unknown): BlueprintWorkerWakeResponseParseResult {
    return isExactRecord(value, ['protocolVersion', 'type']) &&
        value.protocolVersion === blueprintWorkerControlProtocolVersion &&
        value.type === 'accepted'
        ? {
              type: 'valid',
              value: { protocolVersion: blueprintWorkerControlProtocolVersion, type: 'accepted' },
          }
        : { type: 'invalid' };
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        keys.every((key) => key in value) &&
        Object.keys(value).every((key) => keys.includes(key))
    );
}
