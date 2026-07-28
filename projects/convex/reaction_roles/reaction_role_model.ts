import {
    getReactionRoleEmojiKey,
    parseReactionRolePanelDraft,
    type ReactionRoleOption,
    type ReactionRolePanelDraft,
} from '@neonflux/reaction-roles';
import type { GenericId } from 'convex/values';

export type StoredReactionRoleOption = ReactionRoleOption & {
    emojiKey: string;
};

export type StoredReactionRoleVersionPayload = Omit<ReactionRolePanelDraft, 'options'> & {
    options: StoredReactionRoleOption[];
};

export type StoredReactionRoleSelectionSnapshot = {
    emoji: ReactionRoleOption['emoji'];
    grantOwnership: 'panel' | 'preexisting' | 'pending';
    optionId: string;
    roleId: string;
};

export type StoredReactionRolePanel = {
    _id: GenericId<'reactionRolePanels'>;
    appliedVersionId?: GenericId<'reactionRolePanelVersions'>;
    channelId: string;
    createdAt: string;
    createdByUserId: string;
    desiredVersionId?: GenericId<'reactionRolePanelVersions'>;
    errorCode?: string;
    generation: number;
    guildId: string;
    messageId?: string;
    mode: ReactionRolePanelDraft['mode'];
    name: string;
    reconciliationId?: string;
    status: 'publishing' | 'active' | 'updating' | 'deactivating' | 'degraded' | 'unknown' | 'inactive';
    updatedAt: string;
};

export type StoredReactionRoleVersion = {
    _id: GenericId<'reactionRolePanelVersions'>;
    createdAt: string;
    createdByUserId: string;
    fingerprint: string;
    guildId: string;
    panelId: GenericId<'reactionRolePanels'>;
    payload: StoredReactionRoleVersionPayload;
    version: number;
};

export function normalizeReactionRoleVersionPayload(input: unknown): StoredReactionRoleVersionPayload {
    const parsed = parseReactionRolePanelDraft(input);
    if (parsed.isErr()) {
        throw new Error(`reaction-role-panel-invalid:${parsed.error.code}:${parsed.error.path}`);
    }
    return {
        ...parsed.value,
        options: parsed.value.options.map((option) => ({
            ...option,
            emojiKey: getReactionRoleEmojiKey(option.emoji),
        })),
    };
}

export function fingerprintReactionRoleVersion(payload: StoredReactionRoleVersionPayload): string {
    return JSON.stringify({
        content: payload.content ?? null,
        embeds: payload.embeds,
        mode: payload.mode,
        options: payload.options.map(({ emoji, emojiKey, id, roleId, roleName }) => ({
            emoji,
            emojiKey,
            id,
            roleId,
            roleName,
        })),
    });
}

export function normalizeReactionRoleText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string') throw new Error(`reaction-role-${field}-missing`);
    const normalized = value.trim();
    if (!normalized) throw new Error(`reaction-role-${field}-missing`);
    if (normalized.length > maxLength) throw new Error(`reaction-role-${field}-too-long`);
    return normalized;
}

export function toReactionRoleSelectionSnapshot(input: {
    emoji: ReactionRoleOption['emoji'];
    grantOwnership: 'panel' | 'preexisting' | 'pending';
    optionId: string;
    roleId: string;
}): StoredReactionRoleSelectionSnapshot {
    return {
        emoji: input.emoji,
        grantOwnership: input.grantOwnership,
        optionId: input.optionId,
        roleId: input.roleId,
    };
}
