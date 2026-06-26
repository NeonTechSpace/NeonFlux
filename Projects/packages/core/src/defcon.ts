import type { AppEnv, GuildDefconOverride } from '@neonflux/config';

export type GuildDefconLevel = 1 | 2 | 3;

export type DefconFeatureCategory = 'bot_mention' | 'help' | 'prefix' | (string & {});
export type DefconAudience = 'public' | 'guarded';

export const DEFCON_FEATURE_CATEGORY = {
    autorole: 'autorole',
    botMention: 'bot_mention',
    help: 'help',
    importExport: 'import_export',
    logging: 'logging',
    moderation: 'moderation',
    posting: 'posting',
    prefix: 'prefix',
    profileBuilder: 'profile_builder',
    reactionRoles: 'reaction_roles',
    roleReconciliation: 'role_reconciliation',
    suggestions: 'suggestions',
    tickets: 'tickets',
    vcGenerator: 'vc_generator',
    verification: 'verification',
    xp: 'xp',
} as const satisfies Record<string, DefconFeatureCategory>;

export type DefconActor = {
    userId?: string;
    roleIds?: readonly string[];
    isServerOwner: boolean;
    hasManageServer?: boolean;
};

export type DefconGrantRule = {
    userIds?: readonly string[];
    roleIds?: readonly string[];
};

export type DefconPolicyInput = {
    appEnv: AppEnv;
    override: GuildDefconOverride;
    storedLevel?: GuildDefconLevel | null;
};

export type CommandAuthorizationInput = DefconPolicyInput & {
    actor: DefconActor;
    category: DefconFeatureCategory;
    audience: DefconAudience;
    commandGrant?: DefconGrantRule;
    defconOneExemptCategories?: readonly DefconFeatureCategory[];
};

export type DashboardAuthorizationInput = DefconPolicyInput & {
    actor: DefconActor;
    dashboardGrant?: DefconGrantRule;
};

export type DefconAuthorizationResult =
    | {
          allowed: true;
          effectiveDefconLevel: GuildDefconLevel;
      }
    | {
          allowed: false;
          effectiveDefconLevel: GuildDefconLevel;
          reason: DefconAuthorizationDeniedReason;
      };

export type DefconAuthorizationDeniedReason =
    | 'defcon-one-owner-only'
    | 'defcon-two-owner-only'
    | 'missing-command-permission'
    | 'missing-dashboard-permission';

export function resolveEffectiveGuildDefcon(input: DefconPolicyInput): GuildDefconLevel {
    if (input.override !== 'auto') {
        return input.override;
    }

    switch (input.appEnv) {
        case 'development':
            return input.storedLevel ? stricterDefcon(input.storedLevel, 2) : 2;

        case 'production':
            return input.storedLevel ?? 3;
    }
}

export function authorizeCommandAction(input: CommandAuthorizationInput): DefconAuthorizationResult {
    const effectiveDefconLevel = resolveEffectiveGuildDefcon(input);

    if (input.actor.isServerOwner) {
        return allowed(effectiveDefconLevel);
    }

    switch (effectiveDefconLevel) {
        case 1:
            if (input.audience === 'public' && input.defconOneExemptCategories?.includes(input.category) === true) {
                return allowed(effectiveDefconLevel);
            }

            return denied(effectiveDefconLevel, 'defcon-one-owner-only');

        case 2:
            if (input.audience === 'public') {
                return allowed(effectiveDefconLevel);
            }

            return denied(effectiveDefconLevel, 'defcon-two-owner-only');

        case 3:
            if (
                input.audience === 'public' ||
                input.actor.hasManageServer === true ||
                matchesGrant(input.actor, input.commandGrant)
            ) {
                return allowed(effectiveDefconLevel);
            }

            return denied(effectiveDefconLevel, 'missing-command-permission');
    }
}

export function authorizeDashboardAccess(input: DashboardAuthorizationInput): DefconAuthorizationResult {
    const effectiveDefconLevel = resolveEffectiveGuildDefcon(input);

    if (input.actor.isServerOwner) {
        return allowed(effectiveDefconLevel);
    }

    switch (effectiveDefconLevel) {
        case 1:
            return denied(effectiveDefconLevel, 'defcon-one-owner-only');

        case 2:
            return denied(effectiveDefconLevel, 'defcon-two-owner-only');

        case 3:
            if (input.actor.hasManageServer === true || matchesGrant(input.actor, input.dashboardGrant)) {
                return allowed(effectiveDefconLevel);
            }

            return denied(effectiveDefconLevel, 'missing-dashboard-permission');
    }
}

function stricterDefcon(left: GuildDefconLevel, right: GuildDefconLevel): GuildDefconLevel {
    return left < right ? left : right;
}

function matchesGrant(actor: DefconActor, grant: DefconGrantRule | undefined): boolean {
    const userId = actor.userId?.trim();

    if (userId && grant?.userIds?.some((allowedUserId) => allowedUserId.trim() === userId) === true) {
        return true;
    }

    const actorRoleIds = new Set(actor.roleIds?.map((roleId) => roleId.trim()).filter((roleId) => roleId.length > 0));

    if (actorRoleIds.size === 0) {
        return false;
    }

    return grant?.roleIds?.some((roleId) => actorRoleIds.has(roleId.trim())) === true;
}

function allowed(effectiveDefconLevel: GuildDefconLevel): DefconAuthorizationResult {
    return {
        allowed: true,
        effectiveDefconLevel,
    };
}

function denied(
    effectiveDefconLevel: GuildDefconLevel,
    reason: DefconAuthorizationDeniedReason
): DefconAuthorizationResult {
    return {
        allowed: false,
        effectiveDefconLevel,
        reason,
    };
}
