import { AnimatePresence, motion } from 'motion/react';
import type { OutgoingEmbed } from '@neonflux/messaging';
import type { CSSProperties } from 'react';

import { dashboardInlineVariants, dashboardViewTransition } from './dashboard-motion.js';
import { DashboardSurface } from './dashboard-ui.js';

type DashboardPostingPreviewProps = {
    content: string;
    embeds: OutgoingEmbed[];
};

export function DashboardPostingPreview({ content, embeds }: DashboardPostingPreviewProps) {
    const trimmedContent = content.trim();
    const previewEmbedItems = toPreviewEmbedItems(embeds);

    return (
        <DashboardSurface as='section' tone='glass' className='space-y-4' aria-label='Message preview'>
            <div className='border-b border-[var(--dash-border)] pb-3'>
                <p className='text-xs font-semibold tracking-[0.12em] text-[var(--dash-text-subtle)] uppercase'>
                    Fluxer preview
                </p>
                <h3 className='mt-1 text-base font-semibold text-[var(--dash-text)]'>What members will see</h3>
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
                        {trimmedContent ? (
                            <p className='text-sm leading-6 break-words whitespace-pre-wrap text-[#f5f7fb]'>
                                {trimmedContent}
                            </p>
                        ) : null}
                        {previewEmbedItems.map((item) => (
                            <DashboardEmbedPreview key={item.key} embed={item.embed} />
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </DashboardSurface>
    );
}

function DashboardEmbedPreview({ embed }: { embed: OutgoingEmbed }) {
    const color = getEmbedColor(embed);
    const authorName = embed.author?.name;
    const authorIconUrl = embed.author?.iconUrl;
    const title = embed.title;
    const titleUrl = embed.url;
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

    return date.toLocaleString();
}
