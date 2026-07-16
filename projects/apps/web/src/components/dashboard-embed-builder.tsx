import { useId } from 'react';
import type { ReactNode } from 'react';
import { OUTGOING_MESSAGE_LIMITS, parseOutgoingMessage } from '@neonflux/messaging';
import type { OutgoingEmbed } from '@neonflux/messaging';

export type DashboardEmbedDraft = {
    sidebarColor: string;
    authorName: string;
    authorIconUrl: string;
    authorUrl: string;
    title: string;
    titleUrl: string;
    description: string;
    thumbnailUrl: string;
    imageUrl: string;
    footerText: string;
    footerIconUrl: string;
    includeTimestamp: boolean;
};

export type DashboardEmbedPayloadResult =
    | {
          valid: true;
          embed?: OutgoingEmbed;
      }
    | {
          valid: false;
          message: string;
      };

const defaultSidebarColor = '#00ffd5';

export function DashboardEmbedBuilder({
    draft,
    onDraftChange,
}: {
    draft: DashboardEmbedDraft;
    onDraftChange: (draft: DashboardEmbedDraft) => void;
}) {
    function updateDraft<TKey extends keyof DashboardEmbedDraft>(key: TKey, value: DashboardEmbedDraft[TKey]): void {
        onDraftChange({
            ...draft,
            [key]: value,
        });
    }

    const authorConfigured = Boolean(draft.authorName.trim() || draft.authorIconUrl.trim() || draft.authorUrl.trim());
    const mediaConfigured = Boolean(draft.thumbnailUrl.trim() || draft.imageUrl.trim());
    const footerConfigured = Boolean(draft.footerText.trim() || draft.footerIconUrl.trim() || draft.includeTimestamp);
    const embedTextLength = getEmbedTextLength(draft);

    return (
        <section className='space-y-4' aria-label='Embed builder'>
            <div className='grid gap-3 lg:grid-cols-2'>
                <DashboardEmbedColorInput
                    label='Sidebar color'
                    value={draft.sidebarColor}
                    onChange={(value) => updateDraft('sidebarColor', value)}
                />
                <DashboardEmbedTextInput
                    label='Title'
                    value={draft.title}
                    maxLength={OUTGOING_MESSAGE_LIMITS.embedTitle}
                    onChange={(value) => updateDraft('title', value)}
                />
            </div>

            {draft.title.trim() || draft.titleUrl.trim() ? (
                <DashboardEmbedTextInput
                    label='Title URL'
                    value={draft.titleUrl}
                    maxLength={OUTGOING_MESSAGE_LIMITS.url}
                    type='url'
                    onChange={(value) => updateDraft('titleUrl', value)}
                />
            ) : null}

            <label className='space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                <span className='flex items-center justify-between gap-3'>
                    <span>Main body</span>
                    <DashboardCharacterCount
                        value={draft.description}
                        maxLength={OUTGOING_MESSAGE_LIMITS.embedDescription}
                    />
                </span>
                <textarea
                    value={draft.description}
                    onChange={(event) => updateDraft('description', event.currentTarget.value)}
                    maxLength={OUTGOING_MESSAGE_LIMITS.embedDescription}
                    className='min-h-28 w-full resize-y rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 py-2 text-base text-[var(--dash-text)] transition outline-none placeholder:text-[var(--dash-text-disabled)] focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]'
                    placeholder='Add the main embed text.'
                />
            </label>

            <DashboardEmbedDetails title='Author' configured={authorConfigured}>
                <div className='grid gap-3 lg:grid-cols-2'>
                    <DashboardEmbedTextInput
                        label='Author name'
                        value={draft.authorName}
                        maxLength={OUTGOING_MESSAGE_LIMITS.authorName}
                        onChange={(value) => updateDraft('authorName', value)}
                    />
                    {draft.authorName.trim() || draft.authorIconUrl.trim() ? (
                        <DashboardEmbedTextInput
                            label='Author icon URL'
                            value={draft.authorIconUrl}
                            maxLength={OUTGOING_MESSAGE_LIMITS.url}
                            type='url'
                            onChange={(value) => updateDraft('authorIconUrl', value)}
                        />
                    ) : null}
                    {draft.authorName.trim() || draft.authorUrl.trim() ? (
                        <DashboardEmbedTextInput
                            label='Author link URL'
                            value={draft.authorUrl}
                            maxLength={OUTGOING_MESSAGE_LIMITS.url}
                            type='url'
                            onChange={(value) => updateDraft('authorUrl', value)}
                        />
                    ) : null}
                </div>
            </DashboardEmbedDetails>

            <DashboardEmbedDetails title='Media' configured={mediaConfigured}>
                <div className='grid gap-3 lg:grid-cols-2'>
                    <DashboardEmbedTextInput
                        label='Thumbnail URL'
                        value={draft.thumbnailUrl}
                        maxLength={OUTGOING_MESSAGE_LIMITS.url}
                        type='url'
                        onChange={(value) => updateDraft('thumbnailUrl', value)}
                    />
                    <DashboardEmbedTextInput
                        label='Image URL'
                        value={draft.imageUrl}
                        maxLength={OUTGOING_MESSAGE_LIMITS.url}
                        type='url'
                        onChange={(value) => updateDraft('imageUrl', value)}
                    />
                </div>
            </DashboardEmbedDetails>

            <DashboardEmbedDetails title='Footer' configured={footerConfigured}>
                <div className='grid gap-3 lg:grid-cols-2'>
                    <DashboardEmbedTextInput
                        label='Footer text'
                        value={draft.footerText}
                        maxLength={OUTGOING_MESSAGE_LIMITS.embedFooterText}
                        onChange={(value) => updateDraft('footerText', value)}
                    />
                    {draft.footerText.trim() || draft.footerIconUrl.trim() ? (
                        <DashboardEmbedTextInput
                            label='Footer icon URL'
                            value={draft.footerIconUrl}
                            maxLength={OUTGOING_MESSAGE_LIMITS.url}
                            type='url'
                            onChange={(value) => updateDraft('footerIconUrl', value)}
                        />
                    ) : null}
                </div>
                <label className='mt-3 flex min-h-10 items-center gap-3 text-sm font-medium text-[var(--dash-text)]'>
                    <input
                        type='checkbox'
                        checked={draft.includeTimestamp}
                        onChange={(event) => updateDraft('includeTimestamp', event.currentTarget.checked)}
                        className='size-4 rounded border-[var(--dash-border)] bg-[var(--dash-bg)] text-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)] focus:outline-none'
                    />
                    <span>Include current timestamp</span>
                </label>
            </DashboardEmbedDetails>

            <p className='text-right text-xs text-[var(--dash-text-subtle)]'>
                Embed text {embedTextLength.toLocaleString()} /{' '}
                {OUTGOING_MESSAGE_LIMITS.embedTextTotal.toLocaleString()}
            </p>
        </section>
    );
}

export function createEmptyDashboardEmbedDraft(): DashboardEmbedDraft {
    return {
        sidebarColor: '',
        authorName: '',
        authorIconUrl: '',
        authorUrl: '',
        title: '',
        titleUrl: '',
        description: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: '',
        footerIconUrl: '',
        includeTimestamp: false,
    };
}

export function normalizeDashboardEmbedDraft(draft: DashboardEmbedDraft): DashboardEmbedPayloadResult {
    const sidebarColor = draft.sidebarColor.trim();
    const authorName = draft.authorName.trim();
    const authorIconUrl = draft.authorIconUrl.trim();
    const authorUrl = draft.authorUrl.trim();
    const title = draft.title.trim();
    const titleUrl = draft.titleUrl.trim();
    const description = draft.description.trim();
    const thumbnailUrl = draft.thumbnailUrl.trim();
    const imageUrl = draft.imageUrl.trim();
    const footerText = draft.footerText.trim();
    const footerIconUrl = draft.footerIconUrl.trim();
    const colorResult = parseEmbedColor(sidebarColor);

    if (!colorResult.valid) {
        return colorResult;
    }

    if ((authorIconUrl || authorUrl) && !authorName) {
        return {
            valid: false,
            message: 'Add an author name before author icon or link URL.',
        };
    }

    if (titleUrl && !title) {
        return {
            valid: false,
            message: 'Add a title before title URL.',
        };
    }

    if (footerIconUrl && !footerText) {
        return {
            valid: false,
            message: 'Add footer text before footer icon URL.',
        };
    }

    const embed: OutgoingEmbed = {};

    if (colorResult.color !== undefined) {
        embed.color = colorResult.color;
    }

    if (authorName) {
        embed.author = {
            name: authorName,
            ...(authorIconUrl ? { iconUrl: authorIconUrl } : {}),
            ...(authorUrl ? { url: authorUrl } : {}),
        };
    }

    if (title) {
        embed.title = title;
    }

    if (titleUrl) {
        embed.url = titleUrl;
    }

    if (description) {
        embed.description = description;
    }

    if (thumbnailUrl) {
        embed.thumbnailUrl = thumbnailUrl;
    }

    if (imageUrl) {
        embed.imageUrl = imageUrl;
    }

    if (footerText) {
        embed.footer = {
            text: footerText,
            ...(footerIconUrl ? { iconUrl: footerIconUrl } : {}),
        };
    }

    if (draft.includeTimestamp) {
        embed.timestamp = new Date().toISOString();
    }

    if (Object.keys(embed).length === 0) {
        return {
            valid: true,
        };
    }

    const messageResult = parseOutgoingMessage({ embeds: [embed] });
    if (messageResult.isErr()) {
        return {
            valid: false,
            message: describeEmbedValidationError(messageResult.error.code, messageResult.error.path),
        };
    }

    return {
        valid: true,
        embed: messageResult.value.embeds[0],
    };
}

export function toDashboardEmbedDraft(embed: OutgoingEmbed | undefined): DashboardEmbedDraft {
    if (!embed) return createEmptyDashboardEmbedDraft();
    return {
        sidebarColor: embed.color === undefined ? '' : `#${embed.color.toString(16).padStart(6, '0')}`,
        authorName: embed.author?.name ?? '',
        authorIconUrl: embed.author?.iconUrl ?? '',
        authorUrl: embed.author?.url ?? '',
        title: embed.title ?? '',
        titleUrl: embed.url ?? '',
        description: embed.description ?? '',
        thumbnailUrl: embed.thumbnailUrl ?? '',
        imageUrl: embed.imageUrl ?? '',
        footerText: embed.footer?.text ?? '',
        footerIconUrl: embed.footer?.iconUrl ?? '',
        includeTimestamp: embed.timestamp !== undefined,
    };
}

function DashboardEmbedTextInput({
    label,
    value,
    onChange,
    placeholder,
    maxLength,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    maxLength?: number;
    type?: 'text' | 'url';
}) {
    const urlError = type === 'url' ? getUrlError(value) : undefined;

    return (
        <label className='space-y-2 text-sm font-medium text-[var(--dash-text)]'>
            <span className='flex items-center justify-between gap-3'>
                <span>{label}</span>
                {maxLength ? <DashboardCharacterCount value={value} maxLength={maxLength} /> : null}
            </span>
            <input
                type={type}
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                maxLength={maxLength}
                inputMode={type === 'url' ? 'url' : undefined}
                aria-invalid={urlError ? true : undefined}
                className='min-h-10 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 text-base text-[var(--dash-text)] transition outline-none placeholder:text-[var(--dash-text-disabled)] focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]'
                placeholder={placeholder ?? (type === 'url' ? 'https://example.com/…' : undefined)}
            />
            {urlError ? <span className='block text-xs text-[var(--dash-danger)]'>{urlError}</span> : null}
        </label>
    );
}

function DashboardEmbedDetails({
    title,
    configured,
    children,
}: {
    title: string;
    configured: boolean;
    children: ReactNode;
}) {
    return (
        <details className='group rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)]'>
            <summary className='flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--dash-radius-control)] px-3 text-sm font-semibold text-[var(--dash-text)] outline-none focus-visible:shadow-[var(--dash-shadow-focus)] [&::-webkit-details-marker]:hidden'>
                <span>{title}</span>
                <span className='text-xs font-medium text-[var(--dash-text-muted)]'>
                    {configured ? 'Configured' : 'Optional'}
                </span>
            </summary>
            <div className='border-t border-[var(--dash-border)] p-3'>{children}</div>
        </details>
    );
}

function DashboardCharacterCount({ value, maxLength }: { value: string; maxLength: number }) {
    return (
        <span aria-hidden='true' className='text-xs font-normal text-[var(--dash-text-subtle)] tabular-nums'>
            {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </span>
    );
}

function DashboardEmbedColorInput({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    const labelId = useId();
    const hasCustomColor = Boolean(value.trim());
    const visibleValue = hasCustomColor ? value : defaultSidebarColor;

    return (
        <div className='space-y-2 text-sm font-medium text-[var(--dash-text)]'>
            <span id={labelId}>{label}</span>
            <div className='flex min-h-10 items-center gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 transition focus-within:border-[var(--dash-primary)] focus-within:ring-2 focus-within:ring-[var(--dash-primary-ring)]'>
                <span className='relative size-8 shrink-0 overflow-hidden rounded border border-[var(--dash-border)] bg-[var(--dash-surface-muted)]'>
                    <span
                        aria-hidden='true'
                        className='pointer-events-none absolute inset-1 rounded-sm border border-white/10'
                        style={{ backgroundColor: hasCustomColor ? visibleValue : 'transparent' }}
                    />
                    <input
                        type='color'
                        value={visibleValue}
                        onChange={(event) => onChange(event.currentTarget.value)}
                        className='absolute inset-0 size-full cursor-pointer opacity-0'
                        aria-labelledby={labelId}
                    />
                </span>
                <div className='min-w-0 flex-1 text-base'>
                    <p className='truncate text-[var(--dash-text)]'>{hasCustomColor ? value : 'No sidebar color'}</p>
                    <p className='text-xs text-[var(--dash-text-muted)]'>
                        {hasCustomColor ? 'This color appears beside the embed.' : 'Choose a color to add an accent.'}
                    </p>
                </div>
                {hasCustomColor ? (
                    <button
                        type='button'
                        onClick={() => onChange('')}
                        className='inline-flex min-h-8 items-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] px-2 text-xs font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-primary)]'>
                        Clear
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function getEmbedTextLength(draft: DashboardEmbedDraft): number {
    return draft.authorName.length + draft.title.length + draft.description.length + draft.footerText.length;
}

function getUrlError(value: string): string | undefined {
    const normalizedValue = value.trim();
    if (!normalizedValue) return undefined;

    try {
        const url = new URL(normalizedValue);
        return url.protocol === 'https:' || url.protocol === 'http:' ? undefined : 'Use an http:// or https:// URL.';
    } catch {
        return 'Enter a complete http:// or https:// URL.';
    }
}

function describeEmbedValidationError(code: string, path: string): string {
    const field = getEmbedFieldLabel(path);

    switch (code) {
        case 'invalid-url':
            return `Enter a valid http:// or https:// URL for ${field}.`;
        case 'too-long':
            return `${field} exceeds the supported character limit.`;
        case 'payload-too-large':
            return 'The complete message payload is too large.';
        default:
            return `Check ${field}; it contains an unsupported value.`;
    }
}

function getEmbedFieldLabel(path: string): string {
    if (path.endsWith('.author.iconUrl')) return 'author icon';
    if (path.endsWith('.author.url')) return 'author link';
    if (path.endsWith('.footer.iconUrl')) return 'footer icon';
    if (path.endsWith('.thumbnailUrl')) return 'thumbnail';
    if (path.endsWith('.imageUrl')) return 'image';
    if (path.endsWith('.url')) return 'title link';
    if (path.endsWith('.title')) return 'title';
    if (path.endsWith('.description')) return 'main body';
    if (path.endsWith('.author.name')) return 'author name';
    if (path.endsWith('.footer.text')) return 'footer text';
    return 'the embed';
}

function parseEmbedColor(value: string): { valid: true; color?: number } | { valid: false; message: string } {
    if (!value) {
        return { valid: true };
    }

    const normalizedValue = value.startsWith('#') ? value.slice(1) : value;

    if (!/^[0-9a-fA-F]{6}$/.test(normalizedValue)) {
        return {
            valid: false,
            message: 'Embed color must use #RRGGBB.',
        };
    }

    return {
        valid: true,
        color: Number.parseInt(normalizedValue, 16),
    };
}
