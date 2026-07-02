import type { QueryClient } from '@tanstack/react-query';
import { type } from 'arktype';

import { getDashboardAutoroleSettingsQueryKey } from '../dashboard-query-keys.js';
import {
    deleteDashboardAutoroleRuleRouteData,
    updateDashboardAutoroleRuleRouteData,
} from '../server/dashboard-autorole-route-data.js';
import type {
    DashboardAutoroleRole,
    DashboardAutoroleRule,
    DashboardAutoroleSettingsResult,
} from '../server/dashboard-autorole.server.js';

export type AutoroleFormValue = {
    roleId: string;
    roleName: string;
    enabled: boolean;
};

const autoroleFormSchema = type({
    roleId: 'string',
    roleName: 'string',
    enabled: 'boolean',
});

export async function saveAutoroleRuleWithOptimisticUpdate(
    queryClient: QueryClient,
    guildId: string,
    value: AutoroleFormValue
): Promise<{ type: 'success' } | { type: 'error'; message: string }> {
    const queryKey = getDashboardAutoroleSettingsQueryKey(guildId);
    const previous = queryClient.getQueryData<DashboardAutoroleSettingsResult>(queryKey);
    const optimisticRule = createOptimisticRule(previous, value);

    queryClient.setQueryData<DashboardAutoroleSettingsResult>(queryKey, (current) =>
        upsertAutoroleRule(current, optimisticRule)
    );

    try {
        const result = await updateDashboardAutoroleRuleRouteData({
            data: {
                guildId,
                roleId: value.roleId,
                name: value.roleName,
                enabled: value.enabled,
            },
        });

        if (result.type !== 'updated') {
            queryClient.setQueryData(queryKey, previous);
            return { type: 'error', message: toMutationStatus(result.type) };
        }

        queryClient.setQueryData<DashboardAutoroleSettingsResult>(queryKey, (current) =>
            upsertAutoroleRule(current, result.rule)
        );
        await queryClient.invalidateQueries({ queryKey });
        return { type: 'success' };
    } catch {
        queryClient.setQueryData(queryKey, previous);
        return { type: 'error', message: 'Could not save autorole settings.' };
    }
}

export async function deleteAutoroleRuleWithOptimisticUpdate(
    queryClient: QueryClient,
    guildId: string,
    roleId: string
): Promise<{ type: 'success' } | { type: 'error'; message: string }> {
    const queryKey = getDashboardAutoroleSettingsQueryKey(guildId);
    const previous = queryClient.getQueryData<DashboardAutoroleSettingsResult>(queryKey);

    queryClient.setQueryData<DashboardAutoroleSettingsResult>(queryKey, (current) =>
        removeAutoroleRule(current, roleId)
    );

    try {
        const result = await deleteDashboardAutoroleRuleRouteData({
            data: {
                guildId,
                roleId,
            },
        });

        if (result.type !== 'deleted') {
            queryClient.setQueryData(queryKey, previous);
            return { type: 'error', message: toMutationStatus(result.type) };
        }

        await queryClient.invalidateQueries({ queryKey });
        return { type: 'success' };
    } catch {
        queryClient.setQueryData(queryKey, previous);
        return { type: 'error', message: 'Could not remove autorole settings.' };
    }
}

export function parseAutoroleFormValue(
    value: AutoroleFormValue,
    roles: DashboardAutoroleRole[]
): { type: 'valid'; value: AutoroleFormValue } | { type: 'invalid'; message: string } {
    const parsed = autoroleFormSchema(value);

    if (parsed instanceof type.errors) {
        return { type: 'invalid', message: 'Choose a role before saving.' };
    }

    const roleId = parsed.roleId.trim();
    const role = roles.find((candidate) => candidate.id === roleId);

    if (!role) {
        return { type: 'invalid', message: 'Choose a readable server role before saving.' };
    }

    return {
        type: 'valid',
        value: {
            roleId,
            roleName: role.name,
            enabled: parsed.enabled,
        },
    };
}

export function formatRoleLabel(role: Pick<DashboardAutoroleRole, 'name'>): string {
    return `@${role.name}`;
}

export function matchRoles(roles: DashboardAutoroleRole[], query: string): DashboardAutoroleRole[] {
    const normalizedQuery = normalizeRoleSearchText(query);

    if (!normalizedQuery) {
        return roles;
    }

    return roles
        .map((role, index) => ({
            role,
            index,
            score: scoreRoleMatch(role, normalizedQuery),
        }))
        .filter((match): match is { role: DashboardAutoroleRole; index: number; score: number } => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((match) => match.role);
}

export function toMutationStatus(resultType: string): string {
    switch (resultType) {
        case 'invalid-input':
            return 'Choose a role before saving.';
        case 'auth-required':
            return 'Sign in again before changing settings.';
        case 'not-found':
            return 'This server is no longer available.';
        default:
            return 'Could not save autorole settings.';
    }
}

export function formatDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

function createOptimisticRule(
    current: DashboardAutoroleSettingsResult | undefined,
    value: AutoroleFormValue
): DashboardAutoroleRule {
    const existing =
        current?.type === 'settings' ? current.rules.find((rule) => rule.roleId === value.roleId) : undefined;

    return {
        id: existing?.id ?? `optimistic-${value.roleId}`,
        roleId: value.roleId,
        name: value.roleName,
        enabled: value.enabled,
        updatedAt: new Date().toISOString(),
    };
}

function upsertAutoroleRule(
    current: DashboardAutoroleSettingsResult | undefined,
    rule: DashboardAutoroleRule
): DashboardAutoroleSettingsResult | undefined {
    if (!current || current.type !== 'settings') {
        return current;
    }

    const nextRules = current.rules.some((candidate) => candidate.roleId === rule.roleId)
        ? current.rules.map((candidate) => (candidate.roleId === rule.roleId ? rule : candidate))
        : [rule, ...current.rules];

    return {
        ...current,
        rules: nextRules,
    };
}

function removeAutoroleRule(
    current: DashboardAutoroleSettingsResult | undefined,
    roleId: string
): DashboardAutoroleSettingsResult | undefined {
    if (!current || current.type !== 'settings') {
        return current;
    }

    return {
        ...current,
        rules: current.rules.filter((rule) => rule.roleId !== roleId),
    };
}

function scoreRoleMatch(role: DashboardAutoroleRole, query: string): number {
    const tokens = query.split(/\s+/).filter(Boolean);
    const searchableValues = [role.name, role.id, formatRoleLabel(role)].map(normalizeRoleSearchText);
    let score = 0;

    for (const token of tokens) {
        const tokenScore = Math.max(...searchableValues.map((value) => scoreRoleToken(token, value)));

        if (tokenScore === 0) {
            return 0;
        }

        score += tokenScore;
    }

    return score;
}

function scoreRoleToken(token: string, value: string): number {
    if (!value) {
        return 0;
    }

    if (value === token) {
        return 100;
    }

    if (value.startsWith(token)) {
        return 80;
    }

    if (value.includes(token)) {
        return 60;
    }

    return isSubsequence(token, value) ? 30 : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
    let needleIndex = 0;

    for (const character of haystack) {
        if (character === needle[needleIndex]) {
            needleIndex += 1;
        }

        if (needleIndex === needle.length) {
            return true;
        }
    }

    return false;
}

function normalizeRoleSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/[^a-z0-9]+/g, ' ');
}
