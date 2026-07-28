import type { FluxerReactionRoleCatalog } from '@neonflux/fluxer/reaction-roles';
import { parseReactionRolePanelDraft } from '@neonflux/reaction-roles';
import type { ReactionRolePanelDraft } from '@neonflux/reaction-roles';

export function validateDashboardReactionRolePanelInput(
    input: { channelId: string; name: string; payload: unknown },
    catalog: FluxerReactionRoleCatalog
):
    | { channelId: string; name: string; payload: ReactionRolePanelDraft; type: 'valid' }
    | { message: string; type: 'invalid-panel' } {
    const channelId = input.channelId.trim();
    const name = input.name.trim();
    if (!name || name.length > 80) {
        return { message: 'Give the panel a name of at most 80 characters.', type: 'invalid-panel' };
    }
    if (!catalog.channels.some((channel) => channel.id === channelId && channel.eligible)) {
        return { message: 'Choose a channel where the bot can post and manage reactions.', type: 'invalid-panel' };
    }
    const parsed = parseReactionRolePanelDraft(input.payload);
    if (parsed.isErr()) {
        return { message: `The panel is invalid at ${parsed.error.path}.`, type: 'invalid-panel' };
    }
    const eligibleRoleById = new Map(catalog.roles.filter((role) => role.eligible).map((role) => [role.id, role]));
    if (parsed.value.options.some((option) => !eligibleRoleById.has(option.roleId))) {
        return { message: 'One or more roles are privileged, protected, or above the bot.', type: 'invalid-panel' };
    }
    const customEmojiById = new Map(catalog.emojis.map((emoji) => [emoji.id, emoji]));
    if (
        parsed.value.options.some((option) => option.emoji.kind === 'custom' && !customEmojiById.has(option.emoji.id))
    ) {
        return { message: 'One or more server emoji are no longer available.', type: 'invalid-panel' };
    }
    return {
        channelId,
        name,
        payload: {
            ...parsed.value,
            options: parsed.value.options.map((option) => {
                const role = eligibleRoleById.get(option.roleId);
                if (!role) throw new Error('reaction-role-eligibility-invariant');
                if (option.emoji.kind === 'unicode') return { ...option, roleName: role.name };
                const emoji = customEmojiById.get(option.emoji.id);
                if (!emoji) throw new Error('reaction-role-emoji-invariant');
                return {
                    ...option,
                    emoji: {
                        animated: emoji.animated,
                        id: emoji.id,
                        kind: 'custom' as const,
                        name: emoji.name,
                    },
                    roleName: role.name,
                };
            }),
        },
        type: 'valid',
    };
}
