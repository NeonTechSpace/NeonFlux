import type { CSSProperties } from 'react';

import { DashboardSurface } from './dashboard-ui.js';

type DashboardPostingPreviewProps = {
    content: string;
    embeds: unknown[];
};

export function DashboardPostingPreview({ content, embeds }: DashboardPostingPreviewProps) {
    const trimmedContent = content.trim();
    const previewEmbeds = embeds.filter(isRecord);
    const previewEmbedItems = toPreviewEmbedItems(previewEmbeds);

    return (
        <DashboardSurface as='section' tone='raised' className='space-y-4' aria-label='Message preview'>
            <div className='border-b border-[var(--dash-border)] pb-3'>
                <p className='text-xs font-semibold tracking-[0.12em] text-[var(--dash-text-subtle)] uppercase'>
                    Fluxer preview
                </p>
                <h3 className='mt-1 text-base font-semibold text-[var(--dash-text)]'>What members will see</h3>
            </div>
            {!trimmedContent && previewEmbedItems.length === 0 ? (
                <div className='grid min-h-48 place-items-center rounded-[var(--dash-radius-control)] border border-dashed border-[var(--dash-border)] bg-[var(--dash-bg)] px-6 text-center'>
                    <div>
                        <p className='text-sm font-medium text-[var(--dash-text)]'>The preview is empty</p>
                        <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                            Add message content or configure an embed in the editor.
                        </p>
                    </div>
                </div>
            ) : (
                <div className='space-y-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[#0b0d12] p-3'>
                    {trimmedContent ? (
                        <p className='text-sm leading-6 break-words whitespace-pre-wrap text-[#f5f7fb]'>
                            {trimmedContent}
                        </p>
                    ) : null}
                    {previewEmbedItems.map((item) => (
                        <DashboardEmbedPreview key={item.key} embed={item.embed} />
                    ))}
                </div>
            )}
        </DashboardSurface>
    );
}

function DashboardEmbedPreview({ embed }: { embed: Record<string, unknown> }) {
    const color = getEmbedColor(embed);
    const author = readRecord(embed, 'author');
    const authorName = author ? readString(author, 'name') : undefined;
    const authorIconUrl = author ? readString(author, 'icon_url') : undefined;
    const title = readString(embed, 'title');
    const titleUrl = readString(embed, 'url');
    const description = readString(embed, 'description');
    const thumbnailUrl = readRecordString(embed, 'thumbnail', 'url');
    const imageUrl = readRecordString(embed, 'image', 'url');
    const footer = readRecord(embed, 'footer');
    const footerText = footer ? readString(footer, 'text') : undefined;
    const footerIconUrl = footer ? readString(footer, 'icon_url') : undefined;
    const timestamp = readString(embed, 'timestamp');
    const embedStyle: CSSProperties = {
        borderLeftColor: color,
        borderLeftWidth: '4px',
    };

    return (
        <article className='max-w-xl rounded-md border border-[#252a34] bg-[#151820] p-4' style={embedStyle}>
            <div className='flex gap-4'>
                <div className='min-w-0 flex-1 space-y-2'>
                    {authorName ? (
                        <div className='flex min-w-0 items-center gap-2'>
                            {authorIconUrl ? (
                                <img
                                    src={authorIconUrl}
                                    alt=''
                                    className='size-5 shrink-0 rounded-full object-cover'
                                    loading='lazy'
                                    referrerPolicy='no-referrer'
                                />
                            ) : null}
                            <span className='truncate text-xs font-semibold text-[#d8dee9]'>{authorName}</span>
                        </div>
                    ) : null}
                    {title ? (
                        titleUrl ? (
                            <a
                                href={titleUrl}
                                className='block text-sm font-semibold break-words text-[#5ad7ff] hover:text-[#91e5ff]'
                                target='_blank'
                                rel='noreferrer'>
                                {title}
                            </a>
                        ) : (
                            <h4 className='text-sm font-semibold break-words text-[#f6f8fb]'>{title}</h4>
                        )
                    ) : null}
                    {description ? (
                        <p className='text-sm leading-6 break-words whitespace-pre-wrap text-[#d8dee9]'>
                            {description}
                        </p>
                    ) : null}
                </div>
                {thumbnailUrl ? (
                    <img
                        src={thumbnailUrl}
                        alt=''
                        className='size-20 shrink-0 rounded-md object-cover'
                        loading='lazy'
                        referrerPolicy='no-referrer'
                    />
                ) : null}
            </div>
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt=''
                    className='mt-3 max-h-72 w-full rounded-md object-cover'
                    loading='lazy'
                    referrerPolicy='no-referrer'
                />
            ) : null}
            {footerText || timestamp ? (
                <div className='mt-3 flex min-w-0 flex-wrap items-center gap-2 text-xs text-[#8f9bab]'>
                    {footerIconUrl ? (
                        <img
                            src={footerIconUrl}
                            alt=''
                            className='size-5 shrink-0 rounded-full object-cover'
                            loading='lazy'
                            referrerPolicy='no-referrer'
                        />
                    ) : null}
                    {footerText ? <span className='truncate'>{footerText}</span> : null}
                    {footerText && timestamp ? <span aria-hidden='true'>|</span> : null}
                    {timestamp ? <time dateTime={timestamp}>{formatPreviewTimestamp(timestamp)}</time> : null}
                </div>
            ) : null}
        </article>
    );
}

function toPreviewEmbedItems(
    embeds: Array<Record<string, unknown>>
): Array<{ key: string; embed: Record<string, unknown> }> {
    const keyCounts = new Map<string, number>();

    return embeds.map((embed) => {
        const baseKey = getEmbedPreviewBaseKey(embed);
        const keyCount = keyCounts.get(baseKey) ?? 0;
        keyCounts.set(baseKey, keyCount + 1);

        return {
            key: keyCount === 0 ? baseKey : `${baseKey}:${keyCount}`,
            embed,
        };
    });
}

function getEmbedPreviewBaseKey(embed: Record<string, unknown>): string {
    const title = readString(embed, 'title');
    const description = readString(embed, 'description');
    const timestamp = readString(embed, 'timestamp');

    return JSON.stringify({ title, description, timestamp, embed });
}

function getEmbedColor(embed: Record<string, unknown>): string {
    const color = embed.color;

    if (typeof color !== 'number' || !Number.isInteger(color) || color < 0 || color > 0xffffff) {
        return '#525252';
    }

    return `#${color.toString(16).padStart(6, '0')}`;
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
    const childValue = value[key];

    return isRecord(childValue) ? childValue : undefined;
}

function readRecordString(value: Record<string, unknown>, key: string, childKey: string): string | undefined {
    const childValue = readRecord(value, key);

    return childValue ? readString(childValue, childKey) : undefined;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
    const childValue = value[key];

    return typeof childValue === 'string' && childValue.trim() ? childValue.trim() : undefined;
}

function formatPreviewTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
