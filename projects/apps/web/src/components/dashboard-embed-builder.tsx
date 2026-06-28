import { useId } from 'react';

export type DashboardEmbedMode = 'builder' | 'advanced-json';

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

type DashboardEmbedPayload = {
    color?: number;
    author?: {
        name: string;
        icon_url?: string;
        url?: string;
    };
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: {
        url: string;
    };
    image?: {
        url: string;
    };
    footer?: {
        text: string;
        icon_url?: string;
    };
    timestamp?: string;
};

export type DashboardEmbedPayloadResult =
    | {
          valid: true;
          embed?: DashboardEmbedPayload;
      }
    | {
          valid: false;
          message: string;
      };

export type ParsedDashboardEmbedsResult = { valid: true; embeds: unknown[] } | { valid: false; message: string };

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

    return (
        <section className='space-y-3' aria-label='Embed builder'>
            <div className='grid gap-3 lg:grid-cols-2'>
                <DashboardEmbedColorInput
                    label='Sidebar color'
                    value={draft.sidebarColor}
                    onChange={(value) => updateDraft('sidebarColor', value)}
                />
                <DashboardEmbedTextInput
                    label='Author name'
                    value={draft.authorName}
                    onChange={(value) => updateDraft('authorName', value)}
                />
                <DashboardEmbedTextInput
                    label='Author icon URL'
                    value={draft.authorIconUrl}
                    onChange={(value) => updateDraft('authorIconUrl', value)}
                />
                <DashboardEmbedTextInput
                    label='Author link URL'
                    value={draft.authorUrl}
                    onChange={(value) => updateDraft('authorUrl', value)}
                />
                <DashboardEmbedTextInput
                    label='Title'
                    value={draft.title}
                    onChange={(value) => updateDraft('title', value)}
                />
                <DashboardEmbedTextInput
                    label='Title URL'
                    value={draft.titleUrl}
                    onChange={(value) => updateDraft('titleUrl', value)}
                />
            </div>

            <label className='space-y-2 text-sm font-medium text-neutral-200'>
                <span>Main body</span>
                <textarea
                    value={draft.description}
                    onChange={(event) => updateDraft('description', event.currentTarget.value)}
                    className='min-h-28 w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                />
            </label>

            <div className='grid gap-3 lg:grid-cols-2'>
                <DashboardEmbedTextInput
                    label='Thumbnail URL'
                    value={draft.thumbnailUrl}
                    onChange={(value) => updateDraft('thumbnailUrl', value)}
                />
                <DashboardEmbedTextInput
                    label='Image URL'
                    value={draft.imageUrl}
                    onChange={(value) => updateDraft('imageUrl', value)}
                />
                <DashboardEmbedTextInput
                    label='Footer text'
                    value={draft.footerText}
                    onChange={(value) => updateDraft('footerText', value)}
                />
                <DashboardEmbedTextInput
                    label='Footer icon URL'
                    value={draft.footerIconUrl}
                    onChange={(value) => updateDraft('footerIconUrl', value)}
                />
            </div>

            <label className='flex min-h-10 items-center gap-3 text-sm font-medium text-neutral-200'>
                <input
                    type='checkbox'
                    checked={draft.includeTimestamp}
                    onChange={(event) => updateDraft('includeTimestamp', event.currentTarget.checked)}
                    className='size-4 rounded border-neutral-700 bg-neutral-950 text-sky-500 focus:ring-2 focus:ring-sky-400/40 focus:outline-none'
                />
                <span>Timestamp</span>
            </label>
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

    const embed: DashboardEmbedPayload = {};

    if (colorResult.color !== undefined) {
        embed.color = colorResult.color;
    }

    if (authorName) {
        embed.author = {
            name: authorName,
            ...(authorIconUrl ? { icon_url: authorIconUrl } : {}),
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
        embed.thumbnail = {
            url: thumbnailUrl,
        };
    }

    if (imageUrl) {
        embed.image = {
            url: imageUrl,
        };
    }

    if (footerText) {
        embed.footer = {
            text: footerText,
            ...(footerIconUrl ? { icon_url: footerIconUrl } : {}),
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

    return {
        valid: true,
        embed,
    };
}

export function parseDashboardEmbedJson(value: string): ParsedDashboardEmbedsResult {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
        return { valid: true, embeds: [] };
    }

    try {
        const parsedValue: unknown = JSON.parse(trimmedValue);

        if (!Array.isArray(parsedValue) || !parsedValue.every(isEmbedObject)) {
            return {
                valid: false,
                message: 'Embed JSON must be an array of embed objects.',
            };
        }

        return { valid: true, embeds: parsedValue };
    } catch {
        return {
            valid: false,
            message: 'Embed JSON is not valid JSON.',
        };
    }
}

function DashboardEmbedTextInput({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) {
    return (
        <label className='space-y-2 text-sm font-medium text-neutral-200'>
            <span>{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                placeholder={placeholder}
            />
        </label>
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
        <div className='space-y-2 text-sm font-medium text-neutral-200'>
            <span id={labelId}>{label}</span>
            <div className='flex min-h-10 items-center gap-3 rounded-md border border-neutral-700 bg-neutral-950 px-3 transition focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/40'>
                <input
                    type='color'
                    value={visibleValue}
                    onChange={(event) => onChange(event.currentTarget.value)}
                    className='size-8 shrink-0 cursor-pointer rounded border border-neutral-700 bg-transparent p-0'
                    aria-labelledby={labelId}
                />
                <div className='min-w-0 flex-1 text-base'>
                    <p className='truncate text-white'>{hasCustomColor ? value : 'No custom color'}</p>
                    <p className='text-xs text-neutral-500'>Changing the picker adds the embed sidebar color.</p>
                </div>
                {hasCustomColor ? (
                    <button
                        type='button'
                        onClick={() => onChange('')}
                        className='inline-flex min-h-8 items-center rounded-md border border-neutral-700 px-2 text-xs font-semibold text-neutral-200 transition hover:border-neutral-500'>
                        Clear
                    </button>
                ) : null}
            </div>
        </div>
    );
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

function isEmbedObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
