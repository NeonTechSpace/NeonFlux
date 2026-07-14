import { err, ok, type Result } from 'neverthrow';

export type OutgoingEmbedAuthor = {
    name: string;
    iconUrl?: string;
    url?: string;
};

export type OutgoingEmbedField = {
    name: string;
    value: string;
    inline?: boolean;
};

export type OutgoingEmbedFooter = {
    text: string;
    iconUrl?: string;
};

export type OutgoingEmbed = {
    author?: OutgoingEmbedAuthor;
    color?: number;
    description?: string;
    fields?: OutgoingEmbedField[];
    footer?: OutgoingEmbedFooter;
    imageUrl?: string;
    thumbnailUrl?: string;
    timestamp?: string;
    title?: string;
    url?: string;
};

export type OutgoingMessage = {
    content?: string;
    embeds: OutgoingEmbed[];
};

export const DASHBOARD_MESSAGE_MENTION_POLICY = {
    allowedMentionTypes: [] as const,
    kind: 'suppress-all',
    notice: 'Mentions are suppressed; @user, @role, and @everyone will not notify.',
} as const;

export type OutgoingMessageValidationError = {
    code:
        | 'empty-message'
        | 'invalid-array'
        | 'invalid-boolean'
        | 'invalid-color'
        | 'invalid-object'
        | 'invalid-string'
        | 'invalid-timestamp'
        | 'invalid-url'
        | 'missing-required-field'
        | 'payload-too-large'
        | 'too-long'
        | 'too-many'
        | 'unknown-field';
    path: string;
};

export const OUTGOING_MESSAGE_LIMITS = {
    authorName: 256,
    content: 4_000,
    embedDescription: 4_096,
    embedFieldCount: 25,
    embedFieldName: 256,
    embedFieldValue: 1_024,
    embedFooterText: 2_048,
    embedTextTotal: 6_000,
    embedTitle: 256,
    embeds: 10,
    payloadBytes: 128 * 1_024,
    url: 2_048,
} as const;

const messageFields = new Set(['content', 'embeds']);
const embedFields = new Set([
    'author',
    'color',
    'description',
    'fields',
    'footer',
    'imageUrl',
    'thumbnailUrl',
    'timestamp',
    'title',
    'url',
]);
const authorFields = new Set(['name', 'iconUrl', 'url']);
const fieldFields = new Set(['name', 'value', 'inline']);
const footerFields = new Set(['text', 'iconUrl']);

export function parseOutgoingMessage(input: unknown): Result<OutgoingMessage, OutgoingMessageValidationError> {
    if (!isPlainRecord(input)) return err(validationError('invalid-object', 'message'));
    const known = requireKnownFields(input, messageFields, 'message');
    if (known.isErr()) return err(known.error);

    const contentResult = optionalBoundedString(input.content, 'message.content', OUTGOING_MESSAGE_LIMITS.content);
    if (contentResult.isErr()) return err(contentResult.error);
    const embedsResult = parseEmbeds(input.embeds ?? [], 'message.embeds');
    if (embedsResult.isErr()) return err(embedsResult.error);

    const message: OutgoingMessage = {
        ...(contentResult.value ? { content: contentResult.value } : {}),
        embeds: embedsResult.value,
    };
    if (!message.content && message.embeds.length === 0) {
        return err(validationError('empty-message', 'message'));
    }
    if (byteLength(serializeOutgoingMessage(message)) > OUTGOING_MESSAGE_LIMITS.payloadBytes) {
        return err(validationError('payload-too-large', 'message'));
    }
    return ok(message);
}

export function serializeOutgoingMessage(message: OutgoingMessage): string {
    return JSON.stringify({ content: message.content ?? null, embeds: message.embeds });
}

export function serializeDashboardPostingPayload(channelId: string, message: OutgoingMessage): string {
    return JSON.stringify({ channelId: channelId.trim(), content: message.content ?? null, embeds: message.embeds });
}

function parseEmbeds(value: unknown, path: string): Result<OutgoingEmbed[], OutgoingMessageValidationError> {
    if (!Array.isArray(value)) return err(validationError('invalid-array', path));
    if (value.length > OUTGOING_MESSAGE_LIMITS.embeds) return err(validationError('too-many', path));
    const embeds: OutgoingEmbed[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const embed = parseEmbed(value[index], `${path}.${String(index)}`);
        if (embed.isErr()) return err(embed.error);
        embeds.push(embed.value);
    }
    return ok(embeds);
}

function parseEmbed(value: unknown, path: string): Result<OutgoingEmbed, OutgoingMessageValidationError> {
    if (!isPlainRecord(value)) return err(validationError('invalid-object', path));
    const known = requireKnownFields(value, embedFields, path);
    if (known.isErr()) return err(known.error);

    const author = parseOptionalAuthor(value.author, `${path}.author`);
    if (author.isErr()) return err(author.error);
    const color = parseOptionalColor(value.color, `${path}.color`);
    if (color.isErr()) return err(color.error);
    const description = optionalBoundedString(
        value.description,
        `${path}.description`,
        OUTGOING_MESSAGE_LIMITS.embedDescription
    );
    if (description.isErr()) return err(description.error);
    const fields = parseOptionalFields(value.fields, `${path}.fields`);
    if (fields.isErr()) return err(fields.error);
    const footer = parseOptionalFooter(value.footer, `${path}.footer`);
    if (footer.isErr()) return err(footer.error);
    const imageUrl = optionalUrl(value.imageUrl, `${path}.imageUrl`);
    if (imageUrl.isErr()) return err(imageUrl.error);
    const thumbnailUrl = optionalUrl(value.thumbnailUrl, `${path}.thumbnailUrl`);
    if (thumbnailUrl.isErr()) return err(thumbnailUrl.error);
    const timestamp = optionalTimestamp(value.timestamp, `${path}.timestamp`);
    if (timestamp.isErr()) return err(timestamp.error);
    const title = optionalBoundedString(value.title, `${path}.title`, OUTGOING_MESSAGE_LIMITS.embedTitle);
    if (title.isErr()) return err(title.error);
    const url = optionalUrl(value.url, `${path}.url`);
    if (url.isErr()) return err(url.error);

    const embed: OutgoingEmbed = {
        ...(author.value ? { author: author.value } : {}),
        ...(color.value === undefined ? {} : { color: color.value }),
        ...(description.value ? { description: description.value } : {}),
        ...(fields.value ? { fields: fields.value } : {}),
        ...(footer.value ? { footer: footer.value } : {}),
        ...(imageUrl.value ? { imageUrl: imageUrl.value } : {}),
        ...(thumbnailUrl.value ? { thumbnailUrl: thumbnailUrl.value } : {}),
        ...(timestamp.value ? { timestamp: timestamp.value } : {}),
        ...(title.value ? { title: title.value } : {}),
        ...(url.value ? { url: url.value } : {}),
    };
    if (Object.keys(embed).length === 0) return err(validationError('empty-message', path));
    if (countEmbedText(embed) > OUTGOING_MESSAGE_LIMITS.embedTextTotal) {
        return err(validationError('too-long', path));
    }
    return ok(embed);
}

function parseOptionalAuthor(
    value: unknown,
    path: string
): Result<OutgoingEmbedAuthor | undefined, OutgoingMessageValidationError> {
    if (value === undefined) return ok(undefined);
    if (!isPlainRecord(value)) return err(validationError('invalid-object', path));
    const known = requireKnownFields(value, authorFields, path);
    if (known.isErr()) return err(known.error);
    const name = requiredBoundedString(value.name, `${path}.name`, OUTGOING_MESSAGE_LIMITS.authorName);
    if (name.isErr()) return err(name.error);
    const iconUrl = optionalUrl(value.iconUrl, `${path}.iconUrl`);
    if (iconUrl.isErr()) return err(iconUrl.error);
    const url = optionalUrl(value.url, `${path}.url`);
    if (url.isErr()) return err(url.error);
    return ok({
        name: name.value,
        ...(iconUrl.value ? { iconUrl: iconUrl.value } : {}),
        ...(url.value ? { url: url.value } : {}),
    });
}

function parseOptionalFooter(
    value: unknown,
    path: string
): Result<OutgoingEmbedFooter | undefined, OutgoingMessageValidationError> {
    if (value === undefined) return ok(undefined);
    if (!isPlainRecord(value)) return err(validationError('invalid-object', path));
    const known = requireKnownFields(value, footerFields, path);
    if (known.isErr()) return err(known.error);
    const text = requiredBoundedString(value.text, `${path}.text`, OUTGOING_MESSAGE_LIMITS.embedFooterText);
    if (text.isErr()) return err(text.error);
    const iconUrl = optionalUrl(value.iconUrl, `${path}.iconUrl`);
    if (iconUrl.isErr()) return err(iconUrl.error);
    return ok({ text: text.value, ...(iconUrl.value ? { iconUrl: iconUrl.value } : {}) });
}

function parseOptionalFields(
    value: unknown,
    path: string
): Result<OutgoingEmbedField[] | undefined, OutgoingMessageValidationError> {
    if (value === undefined) return ok(undefined);
    if (!Array.isArray(value)) return err(validationError('invalid-array', path));
    if (value.length === 0) return ok(undefined);
    if (value.length > OUTGOING_MESSAGE_LIMITS.embedFieldCount) return err(validationError('too-many', path));
    const fields: OutgoingEmbedField[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const fieldPath = `${path}.${String(index)}`;
        const candidate: unknown = value[index];
        if (!isPlainRecord(candidate)) return err(validationError('invalid-object', fieldPath));
        const known = requireKnownFields(candidate, fieldFields, fieldPath);
        if (known.isErr()) return err(known.error);
        const name = requiredBoundedString(candidate.name, `${fieldPath}.name`, OUTGOING_MESSAGE_LIMITS.embedFieldName);
        if (name.isErr()) return err(name.error);
        const fieldValue = requiredBoundedString(
            candidate.value,
            `${fieldPath}.value`,
            OUTGOING_MESSAGE_LIMITS.embedFieldValue
        );
        if (fieldValue.isErr()) return err(fieldValue.error);
        if (candidate.inline !== undefined && typeof candidate.inline !== 'boolean') {
            return err(validationError('invalid-boolean', `${fieldPath}.inline`));
        }
        fields.push({
            name: name.value,
            value: fieldValue.value,
            ...(typeof candidate.inline === 'boolean' ? { inline: candidate.inline } : {}),
        });
    }
    return ok(fields);
}

function parseOptionalColor(value: unknown, path: string): Result<number | undefined, OutgoingMessageValidationError> {
    if (value === undefined) return ok(undefined);
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff
        ? ok(value)
        : err(validationError('invalid-color', path));
}

function optionalTimestamp(value: unknown, path: string): Result<string | undefined, OutgoingMessageValidationError> {
    if (value === undefined) return ok(undefined);
    if (typeof value !== 'string' || !value.trim()) return err(validationError('invalid-timestamp', path));
    const parsed = Date.parse(value);
    return Number.isFinite(parsed)
        ? ok(new Date(parsed).toISOString())
        : err(validationError('invalid-timestamp', path));
}

function optionalUrl(value: unknown, path: string): Result<string | undefined, OutgoingMessageValidationError> {
    const text = optionalBoundedString(value, path, OUTGOING_MESSAGE_LIMITS.url);
    if (text.isErr() || !text.value) return text;
    try {
        const url = new URL(text.value);
        return url.protocol === 'https:' || url.protocol === 'http:'
            ? ok(url.toString())
            : err(validationError('invalid-url', path));
    } catch {
        return err(validationError('invalid-url', path));
    }
}

function requiredBoundedString(
    value: unknown,
    path: string,
    maxLength: number
): Result<string, OutgoingMessageValidationError> {
    const optional = optionalBoundedString(value, path, maxLength);
    if (optional.isErr()) return err(optional.error);
    return optional.value ? ok(optional.value) : err(validationError('missing-required-field', path));
}

function optionalBoundedString(
    value: unknown,
    path: string,
    maxLength: number
): Result<string | undefined, OutgoingMessageValidationError> {
    if (value === undefined || value === null) return ok(undefined);
    if (typeof value !== 'string') return err(validationError('invalid-string', path));
    const normalized = value.trim();
    if (!normalized) return ok(undefined);
    return normalized.length <= maxLength ? ok(normalized) : err(validationError('too-long', path));
}

function requireKnownFields(
    value: Record<string, unknown>,
    fields: ReadonlySet<string>,
    path: string
): Result<void, OutgoingMessageValidationError> {
    const unknownField = Object.keys(value).find((key) => !fields.has(key));
    return unknownField ? err(validationError('unknown-field', `${path}.${unknownField}`)) : ok(undefined);
}

function countEmbedText(embed: OutgoingEmbed): number {
    return (
        (embed.author?.name.length ?? 0) +
        (embed.title?.length ?? 0) +
        (embed.description?.length ?? 0) +
        (embed.footer?.text.length ?? 0) +
        (embed.fields?.reduce((total, field) => total + field.name.length + field.value.length, 0) ?? 0)
    );
}

function byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validationError(code: OutgoingMessageValidationError['code'], path: string): OutgoingMessageValidationError {
    return { code, path };
}
