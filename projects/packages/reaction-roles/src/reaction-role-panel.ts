import { parseOutgoingMessage, type OutgoingEmbed, type OutgoingMessage } from '@neonflux/messaging';
import { err, ok, type Result } from 'neverthrow';

export const REACTION_ROLE_MARKER = '{roles}';
export const MAX_REACTION_ROLE_OPTIONS = 30;

export type ReactionRoleMode = 'independent' | 'exclusive';

export type ReactionRoleEmoji =
    | {
          kind: 'unicode';
          value: string;
      }
    | {
          animated: boolean;
          id: string;
          kind: 'custom';
          name: string;
      };

export type ReactionRoleOption = {
    emoji: ReactionRoleEmoji;
    id: string;
    roleId: string;
    roleName: string;
};

export type ReactionRolePanelDraft = {
    content?: string;
    embeds: OutgoingEmbed[];
    mode: ReactionRoleMode;
    options: ReactionRoleOption[];
};

export type ReactionRolePanelValidationError = {
    code:
        | 'duplicate-emoji'
        | 'duplicate-marker'
        | 'duplicate-option-id'
        | 'duplicate-role'
        | 'invalid-emoji'
        | 'invalid-message'
        | 'invalid-mode'
        | 'invalid-option'
        | 'too-many-embeds'
        | 'too-many-options'
        | 'too-few-options';
    path: string;
};

export type ReactionRoleProjection = {
    legend: string;
    markerPlacement: 'content' | 'embed';
    message: OutgoingMessage;
};

export function parseReactionRolePanelDraft(
    input: unknown
): Result<ReactionRolePanelDraft, ReactionRolePanelValidationError> {
    if (!isRecord(input)) return err(panelError('invalid-message', 'panel'));
    if (input.mode !== 'independent' && input.mode !== 'exclusive') {
        return err(panelError('invalid-mode', 'panel.mode'));
    }
    if (!Array.isArray(input.options)) return err(panelError('invalid-option', 'panel.options'));
    if (input.options.length === 0) return err(panelError('too-few-options', 'panel.options'));
    if (input.options.length > MAX_REACTION_ROLE_OPTIONS) {
        return err(panelError('too-many-options', 'panel.options'));
    }

    const parsedOptions: ReactionRoleOption[] = [];
    const optionIds = new Set<string>();
    const roleIds = new Set<string>();
    const emojiKeys = new Set<string>();
    for (let index = 0; index < input.options.length; index += 1) {
        const parsed = parseReactionRoleOption(input.options[index], index);
        if (parsed.isErr()) return err(parsed.error);
        if (optionIds.has(parsed.value.id)) {
            return err(panelError('duplicate-option-id', `panel.options.${String(index)}.id`));
        }
        if (roleIds.has(parsed.value.roleId)) {
            return err(panelError('duplicate-role', `panel.options.${String(index)}.roleId`));
        }
        const emojiKey = getReactionRoleEmojiKey(parsed.value.emoji);
        if (emojiKeys.has(emojiKey)) {
            return err(panelError('duplicate-emoji', `panel.options.${String(index)}.emoji`));
        }
        optionIds.add(parsed.value.id);
        roleIds.add(parsed.value.roleId);
        emojiKeys.add(emojiKey);
        parsedOptions.push(parsed.value);
    }

    const embeds = Array.isArray(input.embeds) ? input.embeds : [];
    if (embeds.length > 1) return err(panelError('too-many-embeds', 'panel.embeds'));

    const projection = projectReactionRoleMessage({
        ...(typeof input.content === 'string' ? { content: input.content } : {}),
        embeds: embeds as OutgoingEmbed[],
        mode: input.mode,
        options: parsedOptions,
    });
    if (projection.isErr()) return err(projection.error);

    return ok({
        ...(typeof input.content === 'string' && input.content.trim() ? { content: input.content.trim() } : {}),
        embeds: cloneEmbeds(embeds as OutgoingEmbed[]),
        mode: input.mode,
        options: parsedOptions,
    });
}

export function projectReactionRoleMessage(
    draft: ReactionRolePanelDraft
): Result<ReactionRoleProjection, ReactionRolePanelValidationError> {
    if (draft.embeds.length > 1) return err(panelError('too-many-embeds', 'panel.embeds'));
    if (draft.options.length === 0) return err(panelError('too-few-options', 'panel.options'));
    if (draft.options.length > MAX_REACTION_ROLE_OPTIONS) {
        return err(panelError('too-many-options', 'panel.options'));
    }

    const content = draft.content?.trim() ?? '';
    const embeds = cloneEmbeds(draft.embeds);
    const description = embeds[0]?.description ?? '';
    const contentMarkers = countExactOccurrences(content, REACTION_ROLE_MARKER);
    const embedMarkers = countExactOccurrences(description, REACTION_ROLE_MARKER);
    if (contentMarkers + embedMarkers > 1) {
        return err(panelError('duplicate-marker', 'panel.message'));
    }

    const legend = draft.options.map(formatReactionRoleLegendLine).join('\n');
    let projectedContent = content;
    let placement: ReactionRoleProjection['markerPlacement'];

    if (contentMarkers === 1) {
        projectedContent = content.replace(REACTION_ROLE_MARKER, legend);
        placement = 'content';
    } else if (embedMarkers === 1) {
        const embed = embeds[0];
        if (!embed) return err(panelError('invalid-message', 'panel.embeds.0'));
        embed.description = description.replace(REACTION_ROLE_MARKER, legend);
        placement = 'embed';
    } else if (embeds.length > 0) {
        const embed = embeds[0];
        if (!embed) return err(panelError('invalid-message', 'panel.embeds.0'));
        embed.description = appendBlock(description, legend);
        placement = 'embed';
    } else {
        projectedContent = appendBlock(content, legend);
        placement = 'content';
    }

    const messageResult = parseOutgoingMessage({
        ...(projectedContent ? { content: projectedContent } : {}),
        embeds,
    });
    if (messageResult.isErr()) return err(panelError('invalid-message', messageResult.error.path));

    return ok({
        legend,
        markerPlacement: placement,
        message: messageResult.value,
    });
}

export function formatReactionRoleLegendLine(option: ReactionRoleOption): string {
    return `<@&${option.roleId}> — ${formatReactionRoleEmoji(option.emoji)}`;
}

export function formatReactionRoleEmoji(emoji: ReactionRoleEmoji): string {
    return emoji.kind === 'unicode' ? emoji.value : `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

export function getReactionRoleEmojiIdentifier(
    emoji: ReactionRoleEmoji
): string | { animated: boolean; id: string; name: string } {
    return emoji.kind === 'unicode' ? emoji.value : { animated: emoji.animated, id: emoji.id, name: emoji.name };
}

export function getReactionRoleEmojiKey(emoji: ReactionRoleEmoji): string {
    return emoji.kind === 'custom' ? `custom:${emoji.id}` : `unicode:${emoji.value.normalize('NFC')}`;
}

export function findReactionRoleOptionByEmoji(
    options: readonly ReactionRoleOption[],
    emoji: ReactionRoleEmoji
): ReactionRoleOption | undefined {
    const key = getReactionRoleEmojiKey(emoji);
    return options.find((option) => getReactionRoleEmojiKey(option.emoji) === key);
}

function parseReactionRoleOption(
    value: unknown,
    index: number
): Result<ReactionRoleOption, ReactionRolePanelValidationError> {
    const path = `panel.options.${String(index)}`;
    if (!isRecord(value)) return err(panelError('invalid-option', path));
    const id = normalizeIdentifier(value.id);
    const roleId = normalizeIdentifier(value.roleId);
    const roleName = normalizeLabel(value.roleName);
    if (!id) return err(panelError('invalid-option', `${path}.id`));
    if (!roleId) return err(panelError('invalid-option', `${path}.roleId`));
    if (!roleName) return err(panelError('invalid-option', `${path}.roleName`));
    const emoji = parseReactionRoleEmoji(value.emoji, `${path}.emoji`);
    if (emoji.isErr()) return err(emoji.error);
    return ok({ emoji: emoji.value, id, roleId, roleName });
}

export function parseReactionRoleEmoji(
    value: unknown,
    path = 'emoji'
): Result<ReactionRoleEmoji, ReactionRolePanelValidationError> {
    if (!isRecord(value)) return err(panelError('invalid-emoji', path));
    if (value.kind === 'unicode') {
        const unicode = typeof value.value === 'string' ? value.value.trim().normalize('NFC') : '';
        return unicode && unicode.length <= 32 && isStandardReactionEmoji(unicode)
            ? ok({ kind: 'unicode', value: unicode })
            : err(panelError('invalid-emoji', path));
    }
    if (value.kind === 'custom') {
        const id = normalizeIdentifier(value.id);
        const name = normalizeLabel(value.name);
        if (!id || !name || typeof value.animated !== 'boolean') {
            return err(panelError('invalid-emoji', path));
        }
        return ok({ animated: value.animated, id, kind: 'custom', name });
    }
    return err(panelError('invalid-emoji', path));
}

export function isStandardReactionEmoji(value: string): boolean {
    const normalized = value.trim().normalize('NFC');
    if (!normalized || normalized.length > 32) return false;
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized)];
    if (graphemes.length !== 1) return false;
    return (
        /\p{Extended_Pictographic}/u.test(normalized) ||
        /\p{Regional_Indicator}/u.test(normalized) ||
        /[#*0-9]\uFE0F?\u20E3/u.test(normalized)
    );
}

function appendBlock(existing: string, block: string): string {
    return existing.trim() ? `${existing.trim()}\n\n${block}` : block;
}

function cloneEmbeds(embeds: readonly OutgoingEmbed[]): OutgoingEmbed[] {
    return embeds.map((embed) => ({
        ...embed,
        ...(embed.author ? { author: { ...embed.author } } : {}),
        ...(embed.fields ? { fields: embed.fields.map((field) => ({ ...field })) } : {}),
        ...(embed.footer ? { footer: { ...embed.footer } } : {}),
    }));
}

function countExactOccurrences(value: string, marker: string): number {
    let count = 0;
    let offset = 0;
    for (;;) {
        const index = value.indexOf(marker, offset);
        if (index < 0) return count;
        count += 1;
        offset = index + marker.length;
    }
}

function normalizeIdentifier(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized && normalized.length <= 128 ? normalized : undefined;
}

function normalizeLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized && normalized.length <= 256 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function panelError(code: ReactionRolePanelValidationError['code'], path: string): ReactionRolePanelValidationError {
    return { code, path };
}
