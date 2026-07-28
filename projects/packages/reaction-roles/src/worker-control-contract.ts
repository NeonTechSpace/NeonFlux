import { err, ok, type Result } from 'neverthrow';

export const reactionRoleWorkerControlProtocolVersion = 1 as const;
export const reactionRoleWorkerControlJwtAudience = 'neonflux:bot-internal:reaction-role-worker-control';
export const reactionRoleWorkerWakePath = '/internal/v1/reaction-roles/worker/wake';

export type ReactionRoleWorkerWakeResponse = {
    protocolVersion: typeof reactionRoleWorkerControlProtocolVersion;
    type: 'accepted';
};

export function parseReactionRoleWorkerWakeResponse(
    input: unknown
): Result<ReactionRoleWorkerWakeResponse, 'invalid-response'> {
    if (
        typeof input === 'object' &&
        input !== null &&
        !Array.isArray(input) &&
        (input as Record<string, unknown>).protocolVersion === reactionRoleWorkerControlProtocolVersion &&
        (input as Record<string, unknown>).type === 'accepted'
    ) {
        return ok({
            protocolVersion: reactionRoleWorkerControlProtocolVersion,
            type: 'accepted',
        });
    }
    return err('invalid-response');
}
