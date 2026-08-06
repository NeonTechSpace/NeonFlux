import { AnimatePresence, motion } from 'motion/react';
import type { OutgoingEmbed } from '@neonflux/messaging';
import { Component, lazy, Suspense, useState } from 'react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';

import type {
    DashboardPostingChannel,
    DashboardPostingEmoji,
    DashboardPostingRole,
} from '../server/dashboard-posting.server.js';
import type { DashboardFluxerMarkdownProps } from './dashboard-fluxer-markdown.js';
import { dashboardInlineVariants, dashboardViewTransition } from './dashboard-motion.js';
import { DashboardSurface } from './dashboard-ui.js';

type DashboardPostingPreviewProps = {
    channelLabel?: string;
    channels: DashboardPostingChannel[];
    content: string;
    embeds: OutgoingEmbed[];
    emojis: DashboardPostingEmoji[];
    roles: DashboardPostingRole[];
};

type MarkdownRenderer = ComponentType<DashboardFluxerMarkdownProps>;

export function DashboardPostingPreview({
    channelLabel,
    channels,
    content,
    embeds,
    emojis,
    roles,
}: DashboardPostingPreviewProps) {
    const trimmedContent = content.trim();
    const previewEmbedItems = toPreviewEmbedItems(embeds);

    return (
        <DashboardSurface as='section' tone='glass' className='space-y-4' aria-label='Message preview'>
            <div className='flex flex-wrap items-center justify-between gap-2 border-b border-[var(--dash-border)] pb-3'>
                <h3 className='text-base font-semibold text-[var(--dash-text)]'>Message preview</h3>
                <span className='text-xs text-[var(--dash-text-muted)]'>{channelLabel ?? 'Choose a channel'}</span>
            </div>
            <AnimatePresence initial={false} mode='popLayout'>
                {!trimmedContent && previewEmbedItems.length === 0 ? (
                    <motion.div
                        key='empty'
                        data-dashboard-motion='view-change'
                        className='grid min-h-48 place-items-center rounded-[var(--dash-radius-control)] border border-dashed border-[var(--dash-border)] bg-[var(--dash-bg)] px-6 text-center'
                        variants={dashboardInlineVariants}
                        initial='initial'
                        animate='enter'
                        exit='exit'
                        transition={dashboardViewTransition}>
                        <div>
                            <p className='text-sm font-medium text-[var(--dash-text)]'>The preview is empty</p>
                            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                                Add message content or configure an embed in the editor.
                            </p>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key='message'
                        data-dashboard-motion='view-change'
                        layout
                        className='space-y-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[#0b0d12] p-3'
                        variants={dashboardInlineVariants}
                        initial='initial'
                        animate='enter'
                        exit='exit'
                        transition={dashboardViewTransition}>
                        <FormattedPayloadPreview
                            channels={channels}
                            content={trimmedContent}
                            embeds={previewEmbedItems}
                            emojis={emojis}
                            roles={roles}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </DashboardSurface>
    );
}

function FormattedPayloadPreview({
    channels,
    content,
    embeds,
    emojis,
    roles,
}: {
    channels: DashboardPostingChannel[];
    content: string;
    embeds: Array<{ key: string; embed: OutgoingEmbed }>;
    emojis: DashboardPostingEmoji[];
    roles: DashboardPostingRole[];
}) {
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [Markdown, setMarkdown] = useState(createLazyMarkdownRenderer);

    function retry(): void {
        setMarkdown(() => createLazyMarkdownRenderer());
        setLoadAttempt((attempt) => attempt + 1);
    }

    return (
        <MarkdownCodeLoadBoundary key={loadAttempt} onRetry={retry}>
            <Suspense fallback={<MarkdownLoadingState />}>
                {content ? (
                    <div className='text-sm leading-6 text-[#f5f7fb]'>
                        <Markdown
                            source={content}
                            context='standard'
                            channels={channels}
                            emojis={emojis}
                            roles={roles}
                        />
                    </div>
                ) : null}
                {embeds.map((item) => (
                    <DashboardEmbedPreview
                        key={item.key}
                        embed={item.embed}
                        Markdown={Markdown}
                        channels={channels}
                        emojis={emojis}
                        roles={roles}
                    />
                ))}
            </Suspense>
        </MarkdownCodeLoadBoundary>
    );
}

function createLazyMarkdownRenderer() {
    return lazy(async () => {
        const module = await import('./dashboard-fluxer-markdown.js');
        return { default: module.DashboardFluxerMarkdown };
    });
}

function MarkdownLoadingState() {
    return (
        <div role='status' className='rounded-md border border-[#343b49] bg-[#151820] px-3 py-4 text-sm text-[#aeb8c7]'>
            Loading formatted preview…
        </div>
    );
}

export class MarkdownCodeLoadBoundary extends Component<
    { children: ReactNode; onRetry: () => void },
    { failed: boolean }
> {
    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    render() {
        if (!this.state.failed) return this.props.children;

        return (
            <div role='alert' className='rounded-md border border-[#78444a] bg-[#351d22] px-3 py-3 text-[#ffc3c7]'>
                <p className='text-sm font-medium'>Formatted preview could not be loaded.</p>
                <button
                    type='button'
                    onClick={this.props.onRetry}
                    className='mt-2 min-h-11 cursor-pointer rounded-md border border-[#b86d76] px-3 text-sm font-semibold outline-none hover:bg-[#4a272e] focus-visible:ring-2 focus-visible:ring-[#ff9ba1]'>
                    Retry formatted preview
                </button>
            </div>
        );
    }
}

function DashboardEmbedPreview({
    channels,
    embed,
    emojis,
    Markdown,
    roles,
}: {
    channels: DashboardPostingChannel[];
    embed: OutgoingEmbed;
    emojis: DashboardPostingEmoji[];
    Markdown: MarkdownRenderer;
    roles: DashboardPostingRole[];
}) {
    const color = getEmbedColor(embed);
    const authorName = embed.author?.name;
    const authorIconUrl = embed.author?.iconUrl;
    const authorUrl = readSafePreviewHttpUrl(embed.author?.url);
    const title = embed.title;
    const titleUrl = readSafePreviewHttpUrl(embed.url);
    const description = embed.description;
    const thumbnailUrl = embed.thumbnailUrl;
    const imageUrl = embed.imageUrl;
    const footerText = embed.footer?.text;
    const footerIconUrl = embed.footer?.iconUrl;
    const timestamp = embed.timestamp;
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
                            {authorUrl ? (
                                <a
                                    href={authorUrl}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    className='truncate text-xs font-semibold text-[#5ad7ff] no-underline outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#5ad7ff]'>
                                    {authorName}
                                </a>
                            ) : (
                                <span className='truncate text-xs font-semibold text-[#d8dee9]'>{authorName}</span>
                            )}
                        </div>
                    ) : null}
                    {title ? (
                        titleUrl ? (
                            <a
                                href={titleUrl}
                                className='block text-sm font-semibold break-words text-[#5ad7ff] no-underline outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#5ad7ff]'
                                target='_blank'
                                rel='noopener noreferrer'>
                                <Markdown
                                    source={title}
                                    context='inline'
                                    disableLinks
                                    channels={channels}
                                    emojis={emojis}
                                    roles={roles}
                                />
                            </a>
                        ) : (
                            <h4 className='text-sm font-semibold break-words text-[#f6f8fb]'>
                                <Markdown
                                    source={title}
                                    context='inline'
                                    channels={channels}
                                    emojis={emojis}
                                    roles={roles}
                                />
                            </h4>
                        )
                    ) : null}
                    {description ? (
                        <div className='text-sm leading-6 text-[#d8dee9]'>
                            <Markdown
                                source={description}
                                context='embed'
                                channels={channels}
                                emojis={emojis}
                                roles={roles}
                            />
                        </div>
                    ) : null}
                    {embed.fields && embed.fields.length > 0 ? (
                        <div
                            role='list'
                            aria-label='Embed fields'
                            className='grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-3'>
                            {embed.fields.map((field, index) => (
                                <div
                                    key={`${field.name}:${String(index)}`}
                                    role='listitem'
                                    className={field.inline ? 'min-w-0' : 'min-w-0 sm:col-span-3'}>
                                    <div className='text-xs font-semibold break-words text-[#f6f8fb]'>
                                        <Markdown
                                            source={field.name}
                                            context='inline'
                                            channels={channels}
                                            emojis={emojis}
                                            roles={roles}
                                        />
                                    </div>
                                    <div className='mt-1 text-sm leading-5 text-[#d8dee9]'>
                                        <Markdown
                                            source={field.value}
                                            context='embed'
                                            channels={channels}
                                            emojis={emojis}
                                            roles={roles}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
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
                    {footerText ? (
                        <span className='min-w-0 break-words'>
                            <Markdown
                                source={footerText}
                                context='inline'
                                channels={channels}
                                emojis={emojis}
                                roles={roles}
                            />
                        </span>
                    ) : null}
                    {footerText && timestamp ? <span aria-hidden='true'>|</span> : null}
                    {timestamp ? <time dateTime={timestamp}>{formatPreviewTimestamp(timestamp)}</time> : null}
                </div>
            ) : null}
        </article>
    );
}

function toPreviewEmbedItems(embeds: OutgoingEmbed[]): Array<{ key: string; embed: OutgoingEmbed }> {
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

function getEmbedPreviewBaseKey(embed: OutgoingEmbed): string {
    return JSON.stringify({ title: embed.title, description: embed.description, timestamp: embed.timestamp, embed });
}

function getEmbedColor(embed: OutgoingEmbed): string {
    const color = embed.color;

    if (typeof color !== 'number' || !Number.isInteger(color) || color < 0 || color > 0xffffff) {
        return '#525252';
    }

    return `#${color.toString(16).padStart(6, '0')}`;
}

function formatPreviewTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString('en-US');
}

function readSafePreviewHttpUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;

    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
    } catch {
        return undefined;
    }
}
