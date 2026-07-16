import { err, ok, type Result } from 'neverthrow';

export const postingWorkerControlProtocolVersion = 1 as const;
export const postingWorkerControlJwtAudience = 'neonflux-bot-posting-control-v1';
export const postingWorkerWakePath = '/v1/posting/worker/wake';

export type PostingWorkerWakeResponse = {
    protocolVersion: typeof postingWorkerControlProtocolVersion;
    type: 'accepted';
};

export function parsePostingWorkerWakeResponse(value: unknown): Result<PostingWorkerWakeResponse, 'invalid-response'> {
    return isExactRecord(value, ['protocolVersion', 'type']) &&
        value.protocolVersion === postingWorkerControlProtocolVersion &&
        value.type === 'accepted'
        ? ok({ protocolVersion: postingWorkerControlProtocolVersion, type: 'accepted' })
        : err('invalid-response');
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
