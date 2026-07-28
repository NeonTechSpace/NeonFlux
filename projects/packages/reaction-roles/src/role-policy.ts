export type ReactionRoleCatalogRole = {
    hierarchyRank?: number;
    id: string;
    name: string;
    permissions: string;
    position: number;
    protected?: boolean;
    protectionReason?: 'everyone' | 'bot' | 'integration' | 'managed';
};

export type ReactionRoleRoleEligibility =
    | { eligible: true }
    | {
          eligible: false;
          reason: 'hierarchy' | 'invalid-permissions' | 'privileged' | 'protected';
      };

const allowedPermissionBits = [
    64n, // AddReactions
    512n, // Stream
    1_024n, // ViewChannel
    2_048n, // SendMessages
    4_096n, // SendTTSMessages
    16_384n, // EmbedLinks
    32_768n, // AttachFiles
    65_536n, // ReadMessageHistory
    262_144n, // UseExternalEmojis
    1_048_576n, // Connect
    2_097_152n, // Speak
    33_554_432n, // UseVoiceActivity
    67_108_864n, // ChangeNickname
    137_438_953_472n, // UseExternalStickers
] as const;

const allowedPermissionMask = allowedPermissionBits.reduce((mask, bit) => mask | bit, 0n);

export function evaluateReactionRoleRoleEligibility(input: {
    botHighestRoleHierarchyRank?: number;
    botHighestRolePosition?: number;
    role: ReactionRoleCatalogRole;
}): ReactionRoleRoleEligibility {
    if (input.role.protected) return { eligible: false, reason: 'protected' };

    let permissions: bigint;
    try {
        permissions = BigInt(input.role.permissions);
    } catch {
        return { eligible: false, reason: 'invalid-permissions' };
    }
    if (permissions < 0n) return { eligible: false, reason: 'invalid-permissions' };
    if ((permissions & ~allowedPermissionMask) !== 0n) return { eligible: false, reason: 'privileged' };

    if (typeof input.botHighestRoleHierarchyRank === 'number' && typeof input.role.hierarchyRank === 'number') {
        return input.role.hierarchyRank > input.botHighestRoleHierarchyRank
            ? { eligible: true }
            : { eligible: false, reason: 'hierarchy' };
    }

    if (typeof input.botHighestRolePosition === 'number') {
        return input.role.position < input.botHighestRolePosition
            ? { eligible: true }
            : { eligible: false, reason: 'hierarchy' };
    }

    return { eligible: false, reason: 'hierarchy' };
}
