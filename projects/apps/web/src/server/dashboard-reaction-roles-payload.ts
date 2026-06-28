import type { ReactionRoleMessageMode } from '@neonflux/db';

const maxReactionRoleOptions = 30;

export type DashboardReactionRoleJsonValue =
    | string
    | number
    | boolean
    | null
    | DashboardReactionRoleJsonValue[]
    | { [key: string]: DashboardReactionRoleJsonValue };

export type DashboardReactionRoleEmbedPayload = {
    [key: string]: DashboardReactionRoleJsonValue;
};

export type DashboardReactionRolePublishRole = {
    id: string;
    name: string;
};

type DashboardReactionRolePublishOptionInput = {
    emojiKey: string;
    emojiLabel?: string;
    roleId: string;
    position: number;
};

export type DashboardReactionRolePublishInput = {
    guildId: string;
    channelId: string;
    content?: string;
    embeds?: DashboardReactionRoleEmbedPayload[];
    mode: ReactionRoleMessageMode;
    generateOverview: boolean;
    options: DashboardReactionRolePublishOptionInput[];
};

export type DashboardReactionRolePublishPayload =
    | {
          type: 'payload';
          channelId: string;
          content?: string;
          embeds: DashboardReactionRoleEmbedPayload[];
          mode: ReactionRoleMessageMode;
          generateOverview: boolean;
          options: Array<{ emojiKey: string; emojiLabel: string; roleId: string; position: number }>;
      }
    | { type: 'invalid-input'; field: string; message?: string };

export function normalizeReactionRolePublishPayload(
    input: DashboardReactionRolePublishInput,
    rolesById: ReadonlyMap<string, DashboardReactionRolePublishRole>
): DashboardReactionRolePublishPayload {
    const channelId = input.channelId.trim();
    const content = input.content?.trim();
    const embeds = Array.isArray(input.embeds) ? input.embeds.map(toJsonValue).filter(isSerializableRecord) : [];

    if (!channelId) return { type: 'invalid-input', field: 'channelId' };
    if (!Array.isArray(input.options) || input.options.length === 0) return { type: 'invalid-input', field: 'options' };

    if (input.options.length > maxReactionRoleOptions) {
        return {
            type: 'invalid-input',
            field: 'options',
            message: `Reaction-role messages support up to ${maxReactionRoleOptions} options.`,
        };
    }

    const seenEmojiKeys = new Set<string>();
    const normalizedOptions = input.options.map((option, index) => ({
        emojiKey: option.emojiKey.trim(),
        emojiLabel: option.emojiLabel?.trim() || option.emojiKey.trim(),
        roleId: option.roleId.trim(),
        position: Number.isInteger(option.position) ? option.position : index,
    }));

    for (const option of normalizedOptions) {
        if (!option.emojiKey) return { type: 'invalid-input', field: 'emojiKey' };
        if (!option.roleId || !rolesById.has(option.roleId)) return { type: 'invalid-input', field: 'roleId' };
        if (seenEmojiKeys.has(option.emojiKey)) return { type: 'invalid-input', field: 'emojiKey' };
        if (option.position < 0) return { type: 'invalid-input', field: 'position' };
        seenEmojiKeys.add(option.emojiKey);
    }

    const overviewPayload = input.generateOverview
        ? applyReactionRoleOverview({ content, embeds, options: normalizedOptions, rolesById })
        : { content, embeds };

    if (!overviewPayload.content && overviewPayload.embeds.length === 0) {
        return {
            type: 'invalid-input',
            field: 'message',
            message: 'Add message content, an embed, or generated overview.',
        };
    }

    return {
        type: 'payload',
        channelId,
        ...(overviewPayload.content ? { content: overviewPayload.content } : {}),
        embeds: overviewPayload.embeds,
        mode: input.mode,
        generateOverview: input.generateOverview,
        options: normalizedOptions,
    };
}

function applyReactionRoleOverview({
    content,
    embeds,
    options,
    rolesById,
}: {
    content?: string;
    embeds: DashboardReactionRoleEmbedPayload[];
    options: Array<{ emojiKey: string; emojiLabel: string; roleId: string }>;
    rolesById: ReadonlyMap<string, DashboardReactionRolePublishRole>;
}): { content?: string; embeds: DashboardReactionRoleEmbedPayload[] } {
    const legend = options
        .map((option) => {
            const role = rolesById.get(option.roleId);
            const roleLabel = role ? `<@&${role.id}> (${role.name})` : option.roleId;

            return `${option.emojiLabel} - ${roleLabel}`;
        })
        .join('\n');

    if (content?.includes('{list}')) {
        return { content: content.replaceAll('{list}', legend), embeds };
    }

    const clonedEmbeds = embeds.map((embed) => ({ ...embed }));
    if (clonedEmbeds.length > 0) {
        const firstEmbed = clonedEmbeds[0];
        const description = typeof firstEmbed.description === 'string' ? firstEmbed.description : '';

        firstEmbed.description = description.includes('{list}')
            ? description.replaceAll('{list}', legend)
            : [description.trim(), legend].filter(Boolean).join('\n\n');

        return { ...(content ? { content } : {}), embeds: clonedEmbeds };
    }

    return { content: content ? `${content}\n\n${legend}` : legend, embeds };
}

function isSerializableRecord(value: unknown): value is DashboardReactionRoleEmbedPayload {
    const jsonValue = toJsonValue(value);

    return typeof jsonValue === 'object' && jsonValue !== null && !Array.isArray(jsonValue);
}

function toJsonValue(value: unknown): DashboardReactionRoleJsonValue | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (Array.isArray(value)) {
        return value.map(toJsonValue).filter((item) => item !== undefined);
    }

    if (typeof value === 'object') {
        const output: { [key: string]: DashboardReactionRoleJsonValue } = {};

        for (const [key, child] of Object.entries(value)) {
            const jsonValue = toJsonValue(child);

            if (jsonValue !== undefined) {
                output[key] = jsonValue;
            }
        }

        return output;
    }

    return undefined;
}
