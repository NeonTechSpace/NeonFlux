export type DeletedGuildRoleReferenceCleanupSummary = {
    autoroleRulesDisabled: number;
    commandPermissionRulesUpdated: number;
    dashboardPermissionRulesUpdated: number;
    moderationPoliciesUpdated: number;
    reactionRoleAssignmentsRemoved: number;
    reactionRoleOptionsDeleted: number;
    ticketPanelsDisabled: number;
    ticketPanelsUpdated: number;
    verificationFlowsDisabled: number;
    xpRoleRewardsDeleted: number;
};

export type DeletedGuildRoleReferenceCleanupResult =
    | {
          runId: string;
          status: 'cleaned';
          summary: DeletedGuildRoleReferenceCleanupSummary;
      }
    | {
          status: 'unchanged';
          summary: DeletedGuildRoleReferenceCleanupSummary;
      };

export type DeletedGuildRoleReferenceCleanupInput = {
    guildId?: string | null;
    occurredAt?: string | null;
    roleId?: string | null;
};

export type DeletedGuildRoleReferenceCleanupDocumentInput = {
    guildId: string;
    roleId: string;
    updatedAt: string;
};

export type RoleReferenceCleanupInputError = { field: string; type: 'invalid-value' | 'missing-input' };

export type RoleReferenceCleanupInputResult<Value> =
    | { ok: true; value: Value }
    | { error: RoleReferenceCleanupInputError; ok: false };

export type RoleIdArrayRemoval = { changed: false } | { changed: true; values: string[] };

export type RoleIdConfigRemoval =
    | { changed: false }
    | { changed: true; config: Record<string, unknown>; values: string[] };

export function createEmptyDeletedRoleCleanupSummary(): DeletedGuildRoleReferenceCleanupSummary {
    return {
        autoroleRulesDisabled: 0,
        commandPermissionRulesUpdated: 0,
        dashboardPermissionRulesUpdated: 0,
        moderationPoliciesUpdated: 0,
        reactionRoleAssignmentsRemoved: 0,
        reactionRoleOptionsDeleted: 0,
        ticketPanelsDisabled: 0,
        ticketPanelsUpdated: 0,
        verificationFlowsDisabled: 0,
        xpRoleRewardsDeleted: 0,
    };
}

export function hasDeletedRoleCleanupChanges(summary: DeletedGuildRoleReferenceCleanupSummary): boolean {
    return Object.values(summary).some((count) => count > 0);
}

export function normalizeDeletedRoleCleanupInput(
    input: DeletedGuildRoleReferenceCleanupInput,
    now: string
): RoleReferenceCleanupInputResult<DeletedGuildRoleReferenceCleanupDocumentInput> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const roleId = normalizeRequiredString(input.roleId, 'roleId');
    const updatedAt = input.occurredAt === undefined ? normalizeTimestamp(now) : normalizeTimestamp(input.occurredAt);

    if (!guildId.ok) return guildId;
    if (!roleId.ok) return roleId;
    if (!updatedAt) return { error: { field: 'occurredAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            guildId: guildId.value,
            roleId: roleId.value,
            updatedAt,
        },
    };
}

export function removeRoleIdFromStringArray(value: unknown, roleId: string): RoleIdArrayRemoval {
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
        return { changed: false };
    }

    if (!value.includes(roleId)) {
        return { changed: false };
    }

    return {
        changed: true,
        values: value.filter((item) => item !== roleId),
    };
}

export function removeRoleIdFromConfigArray(config: unknown, key: string, roleId: string): RoleIdConfigRemoval {
    if (!isPlainRecord(config)) {
        return { changed: false };
    }

    const removal = removeRoleIdFromStringArray(config[key], roleId);

    if (!removal.changed) {
        return { changed: false };
    }

    return {
        changed: true,
        config: {
            ...config,
            [key]: removal.values,
        },
        values: removal.values,
    };
}

export function shouldDisablePrivateTicketPanel(input: {
    enabled: boolean;
    staffRoleIds: readonly string[];
    config: Record<string, unknown>;
}): boolean {
    return input.enabled && input.config.privateTickets !== false && input.staffRoleIds.length === 0;
}

function normalizeRequiredString(
    value: string | null | undefined,
    field: string
): RoleReferenceCleanupInputResult<string> {
    const normalizedValue = value?.trim();

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
