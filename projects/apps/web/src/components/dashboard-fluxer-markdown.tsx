import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type {
    DashboardPostingChannel,
    DashboardPostingEmoji,
    DashboardPostingRole,
} from '../server/dashboard-posting.server.js';
import { parseDashboardMarkdown } from './dashboard-fluxer-markdown-parser.js';
import type { DashboardMarkdownContext, DashboardMarkdownNode } from './dashboard-fluxer-markdown-parser.js';

export type DashboardFluxerMarkdownProps = {
    channels: DashboardPostingChannel[];
    context: DashboardMarkdownContext;
    disableLinks?: boolean;
    emojis: DashboardPostingEmoji[];
    roles: DashboardPostingRole[];
    source: string;
};

type RenderOptions = {
    channelById: ReadonlyMap<string, DashboardPostingChannel>;
    context: DashboardMarkdownContext;
    disableLinks: boolean;
    emojiById: ReadonlyMap<string, DashboardPostingEmoji>;
    hiddenBySpoiler?: boolean;
    roleById: ReadonlyMap<string, DashboardPostingRole>;
};

const mentionClassName =
    'mx-0.5 inline-flex max-w-full items-center rounded px-1 py-px align-baseline text-[0.9em] font-medium break-all text-[#dce6ff] ring-1 ring-inset ring-[#7f91ba66] bg-[#58698f4d]';
const linkClassName =
    'break-words text-[#5ad7ff] no-underline outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[#5ad7ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0d12]';

export function DashboardFluxerMarkdown({
    channels,
    context,
    disableLinks = false,
    emojis,
    roles,
    source,
}: DashboardFluxerMarkdownProps) {
    const parseResult = useMemo(() => parseDashboardMarkdown(source, context), [context, source]);
    const channelById = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels]);
    const emojiById = useMemo(() => new Map(emojis.map((emoji) => [emoji.id, emoji])), [emojis]);
    const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
    const options: RenderOptions = { channelById, context, disableLinks, emojiById, roleById };

    if (parseResult.type === 'plain') {
        return (
            <span className='break-words whitespace-pre-wrap'>
                {source}
                <span className='sr-only' role='status'>
                    Formatted preview unavailable; showing plain text.
                </span>
            </span>
        );
    }

    if (context === 'inline') {
        return (
            <span className='break-words whitespace-normal'>{renderNodes(parseResult.nodes, options, 'inline')}</span>
        );
    }

    return (
        <div className='min-w-0 break-words whitespace-break-spaces'>
            {renderNodes(parseResult.nodes, options, context)}
        </div>
    );
}

function renderNodes(nodes: DashboardMarkdownNode[], options: RenderOptions, keyPrefix: string): ReactNode[] {
    return nodes.map((node, index) => renderNode(node, options, `${keyPrefix}-${String(index)}-${node.type}`));
}

function renderNode(node: DashboardMarkdownNode, options: RenderOptions, key: string): ReactNode {
    const content = getContentNodes(node);

    switch (node.type) {
        case 'text':
            return typeof node.content === 'string' ? node.content : '';
        case 'paragraph':
            return (
                <div key={key} className='mb-2 last:mb-0'>
                    {renderNodes(content, options, key)}
                </div>
            );
        case 'strong':
            return (
                <strong key={key} className='font-semibold'>
                    {renderNodes(content, options, key)}
                </strong>
            );
        case 'em':
            return <em key={key}>{renderNodes(content, options, key)}</em>;
        case 'underline':
            return (
                <u key={key} className='decoration-from-font underline-offset-2'>
                    {renderNodes(content, options, key)}
                </u>
            );
        case 'strikethrough':
            return <s key={key}>{renderNodes(content, options, key)}</s>;
        case 'newline':
        case 'br':
            return <br key={key} />;
        case 'inlineCode':
            return (
                <code
                    key={key}
                    className='rounded border border-[#343b49] bg-[#20242d] px-1 py-0.5 font-mono text-[0.85em] text-[#e6edf7]'>
                    {typeof node.content === 'string' ? node.content : plainText(content)}
                </code>
            );
        case 'codeBlock':
            return options.context === 'inline' ? (
                <code
                    key={key}
                    className='rounded border border-[#343b49] bg-[#20242d] px-1 py-0.5 font-mono text-[0.85em] text-[#e6edf7]'>
                    {typeof node.content === 'string' ? node.content : plainText(content)}
                </code>
            ) : (
                <CodeBlock key={key} node={node} />
            );
        case 'spoiler':
            return <Spoiler key={key} nodes={content} options={options} />;
        case 'heading':
            return renderHeading(node, options, key);
        case 'subtext':
            return (
                <small key={key} className='block text-[0.8125em] leading-5 text-[#9ca7b7]'>
                    {renderNodes(content, options, key)}
                </small>
            );
        case 'blockQuote':
            return renderBlockQuote(content, options, key);
        case 'list':
            return renderList(node, options, key);
        case 'table':
            return renderTable(node, options, key);
        case 'link':
        case 'url':
        case 'autolink':
            return renderLink(node, options, key);
        case 'role':
            return renderRoleMention(node, options, key);
        case 'channel':
            return renderChannelMention(node, options, key);
        case 'user':
            return <Mention key={key} label={`@${node.id ?? 'unknown-user'}`} />;
        case 'everyone':
            return <Mention key={key} label='@everyone' />;
        case 'here':
            return <Mention key={key} label='@here' />;
        case 'timestamp':
            return renderTimestamp(node, key);
        case 'twemoji':
            return node.name ?? '';
        case 'emoji':
            return renderCustomEmoji(node, options, key);
        case 'slashCommand':
            return <Mention key={key} label={`/${node.fullName ?? node.name ?? 'command'}`} />;
        case 'guildNavigation':
            return renderGuildNavigation(node);
        default:
            return plainText(content) || (typeof node.content === 'string' ? node.content : '');
    }
}

function renderCustomEmoji(node: DashboardMarkdownNode, options: RenderOptions, key: string): ReactNode {
    const emoji = node.id ? options.emojiById.get(node.id) : undefined;
    if (!emoji) return `<${node.animated ? 'a' : ''}:${node.name ?? 'emoji'}:${node.id ?? 'unknown'}>`;
    return (
        <img
            key={key}
            src={emoji.url}
            alt={`:${emoji.name}:`}
            title={`:${emoji.name}:`}
            loading='lazy'
            referrerPolicy='no-referrer'
            className='mx-0.5 inline-block size-[1.35em] object-contain align-[-0.28em]'
        />
    );
}

function CodeBlock({ node }: { node: DashboardMarkdownNode }) {
    const content = typeof node.content === 'string' ? node.content : plainText(getContentNodes(node));
    const language = node.lang?.trim();

    return (
        <div
            role='region'
            aria-label={language ? `${language} code block` : 'Code block'}
            className='my-2 max-w-full overflow-hidden rounded-md border border-[#343b49] bg-[#171a21] last:mb-0'>
            {language ? (
                <div className='border-b border-[#343b49] px-3 py-1 font-mono text-[0.68rem] text-[#9ca7b7]'>
                    {language}
                </div>
            ) : null}
            <pre className='max-w-full overflow-x-auto p-3 font-mono text-xs leading-5 whitespace-pre text-[#e6edf7]'>
                <code>{content}</code>
            </pre>
        </div>
    );
}

function Spoiler({ nodes, options }: { nodes: DashboardMarkdownNode[]; options: RenderOptions }) {
    const [revealed, setRevealed] = useState(false);

    if (revealed) {
        return (
            <span aria-label='Revealed spoiler' data-revealed='true' className='rounded bg-[#303541] px-0.5'>
                {renderNodes(nodes, options, 'revealed-spoiler')}
            </span>
        );
    }

    function reveal(): void {
        setRevealed(true);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>): void {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        reveal();
    }

    return (
        <span
            role='button'
            tabIndex={0}
            aria-label='Reveal spoiler'
            onClick={reveal}
            onKeyDown={handleKeyDown}
            className='inline-block cursor-pointer rounded bg-[#4b5362] px-0.5 outline-none hover:bg-[#5b6475] focus-visible:ring-2 focus-visible:ring-[#8ea1c9]'>
            <span aria-hidden='true' className='opacity-0 select-none'>
                {renderNodes(nodes, { ...options, disableLinks: true, hiddenBySpoiler: true }, 'hidden-spoiler')}
            </span>
        </span>
    );
}

function renderHeading(node: DashboardMarkdownNode, options: RenderOptions, key: string): ReactNode {
    const children = renderNodes(getContentNodes(node), options, key);
    const className = 'mt-3 mb-1 font-semibold leading-tight first:mt-0';

    switch (node.level) {
        case 1:
            return (
                <h1 key={key} className={`${className} text-[1.375em]`}>
                    {children}
                </h1>
            );
        case 2:
            return (
                <h2 key={key} className={`${className} text-[1.25em]`}>
                    {children}
                </h2>
            );
        default:
            return (
                <h3 key={key} className={`${className} text-[1.125em]`}>
                    {children}
                </h3>
            );
    }
}

function renderBlockQuote(content: DashboardMarkdownNode[], options: RenderOptions, key: string): ReactNode {
    const alert = readAlert(content);

    if (alert) {
        return (
            <aside key={key} className={`my-1 rounded-r-md border-l-4 px-3 py-2 ${getAlertClassName(alert.kind)}`}>
                <p className='mb-1 text-xs font-semibold tracking-wide uppercase'>{formatAlertKind(alert.kind)}</p>
                <div className='text-[#d8dee9]'>{renderNodes(alert.content, options, `${key}-alert`)}</div>
            </aside>
        );
    }

    return (
        <blockquote key={key} aria-label='Quote' className='my-1 border-l-4 border-[#596273] pl-3 text-[#aeb8c7]'>
            {renderNodes(content, options, key)}
        </blockquote>
    );
}

function renderList(node: DashboardMarkdownNode, options: RenderOptions, key: string): ReactNode {
    const items = node.items ?? [];
    const className = 'my-1 ml-5 space-y-1 pl-1';
    const children = items.map((item, index) => (
        <li key={`${key}-${String(index)}`}>{renderNodes(item, options, `${key}-${String(index)}`)}</li>
    ));

    return node.ordered ? (
        <ol key={key} start={node.start} className={`${className} list-decimal`}>
            {children}
        </ol>
    ) : (
        <ul key={key} className={`${className} list-disc`}>
            {children}
        </ul>
    );
}

function renderTable(node: DashboardMarkdownNode, options: RenderOptions, key: string): ReactNode {
    const header = node.header ?? [];
    const cells = node.cells ?? [];

    return (
        <div key={key} className='my-2 max-w-full overflow-x-auto rounded-md border border-[#343b49]'>
            <table className='w-max min-w-full border-collapse text-left text-[0.875em]'>
                <thead className='bg-[#242935] text-[#f2f5fa]'>
                    <tr>
                        {header.map((cell, index) => (
                            <th
                                key={`${key}-head-${String(index)}`}
                                scope='col'
                                style={{ textAlign: node.align?.[index] ?? 'left' }}
                                className='border-r border-[#343b49] px-3 py-2 last:border-r-0'>
                                {renderNodes(cell, options, `${key}-head-${String(index)}`)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {cells.map((row, rowIndex) => (
                        <tr key={`${key}-row-${String(rowIndex)}`} className='even:bg-[#1b1f28]'>
                            {row.map((cell, cellIndex) => (
                                <td
                                    key={`${key}-cell-${String(rowIndex)}-${String(cellIndex)}`}
                                    style={{ textAlign: node.align?.[cellIndex] ?? 'left' }}
                                    className='border-t border-r border-[#343b49] px-3 py-2 last:border-r-0'>
                                    {renderNodes(cell, options, `${key}-cell-${String(rowIndex)}-${String(cellIndex)}`)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function renderLink(node: DashboardMarkdownNode, options: RenderOptions, key: string): ReactNode {
    const content = getContentNodes(node);
    const children = content.length > 0 ? renderNodes(content, options, key) : node.target;
    const target = readSafeHttpUrl(node.target);

    if (!target || options.disableLinks || options.hiddenBySpoiler) {
        return <span key={key}>{children}</span>;
    }

    return (
        <a
            key={key}
            href={target}
            title={node.title}
            target='_blank'
            rel='noopener noreferrer'
            className={linkClassName}>
            {children}
        </a>
    );
}

function renderRoleMention(node: DashboardMarkdownNode, options: RenderOptions, key: string): ReactNode {
    const role = node.id ? options.roleById.get(node.id) : undefined;
    const color = role && role.color > 0 && role.color <= 0xffffff ? toHexColor(role.color) : undefined;
    const style: CSSProperties | undefined = color
        ? {
              backgroundColor: `${color}2e`,
              boxShadow: `inset 0 0 0 1px ${color}73`,
              color,
          }
        : undefined;

    return <Mention key={key} label={role ? `@${role.name}` : '@Unknown role'} style={style} />;
}

function renderChannelMention(node: DashboardMarkdownNode, options: RenderOptions, key: string): ReactNode {
    const channel = node.id ? options.channelById.get(node.id) : undefined;
    return <Mention key={key} label={channel ? `#${channel.name}` : '#unknown-channel'} />;
}

function Mention({ label, style }: { label: string; style?: CSSProperties }) {
    return (
        <span className={mentionClassName} style={style}>
            {label}
        </span>
    );
}

function renderTimestamp(node: DashboardMarkdownNode, key: string): ReactNode {
    const seconds = Number(node.timestamp);
    const date = new Date(seconds * 1_000);

    if (!Number.isFinite(seconds) || Number.isNaN(date.getTime())) {
        return `<t:${node.timestamp ?? ''}${node.format ? `:${node.format}` : ''}>`;
    }

    return (
        <time
            key={key}
            dateTime={date.toISOString()}
            title={date.toLocaleString('en-US')}
            className='rounded bg-[#303541] px-1 py-px'>
            {formatTimestamp(date, node.format)}
        </time>
    );
}

function formatTimestamp(date: Date, format = 'f'): string {
    if (format === 'R') return formatRelativeTime(date);

    const optionsByFormat: Record<string, Intl.DateTimeFormatOptions> = {
        t: { hour: 'numeric', minute: '2-digit' },
        T: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
        d: { day: '2-digit', month: '2-digit', year: 'numeric' },
        D: { day: 'numeric', month: 'long', year: 'numeric' },
        f: { day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'long', year: 'numeric' },
        F: { day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'long', weekday: 'long', year: 'numeric' },
    };

    return new Intl.DateTimeFormat(undefined, optionsByFormat[format] ?? optionsByFormat.f).format(date);
}

function formatRelativeTime(date: Date): string {
    const difference = date.getTime() - Date.now();
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['year', 365 * 24 * 60 * 60 * 1_000],
        ['month', 30 * 24 * 60 * 60 * 1_000],
        ['day', 24 * 60 * 60 * 1_000],
        ['hour', 60 * 60 * 1_000],
        ['minute', 60 * 1_000],
        ['second', 1_000],
    ];
    const [unit, size] = units.find(([, unitSize]) => Math.abs(difference) >= unitSize) ?? units.at(-1)!;
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(difference / size), unit);
}

function readSafeHttpUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;

    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
    } catch {
        return undefined;
    }
}

function getContentNodes(node: DashboardMarkdownNode): DashboardMarkdownNode[] {
    return Array.isArray(node.content) ? node.content : [];
}

function plainText(nodes: DashboardMarkdownNode[]): string {
    return nodes
        .map((node) => {
            if (node.type === 'newline' || node.type === 'br') return '\n';
            if (typeof node.content === 'string') return node.content;
            if (Array.isArray(node.content)) return plainText(node.content);
            if (node.type === 'twemoji') return node.name ?? '';
            if (node.type === 'emoji') return `:${node.name ?? 'emoji'}:`;
            return '';
        })
        .join('');
}

type AlertKind = 'CAUTION' | 'IMPORTANT' | 'NOTE' | 'TIP' | 'WARNING';

function readAlert(
    content: DashboardMarkdownNode[]
): { content: DashboardMarkdownNode[]; kind: AlertKind } | undefined {
    const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/iu.exec(plainText(content));
    if (!match?.[1]) return undefined;

    return {
        kind: match[1].toUpperCase() as AlertKind,
        content: stripPlainTextPrefix(content, match[0].length),
    };
}

function stripPlainTextPrefix(nodes: DashboardMarkdownNode[], count: number): DashboardMarkdownNode[] {
    let remaining = count;
    const result: DashboardMarkdownNode[] = [];

    for (const node of nodes) {
        if (remaining <= 0) {
            result.push(node);
            continue;
        }

        if (node.type === 'newline' || node.type === 'br') {
            remaining -= 1;
            continue;
        }

        if (typeof node.content === 'string') {
            if (node.content.length <= remaining) {
                remaining -= node.content.length;
                continue;
            }
            result.push({ ...node, content: node.content.slice(remaining) });
            remaining = 0;
            continue;
        }

        result.push(node);
    }

    return result;
}

function getAlertClassName(kind: AlertKind): string {
    switch (kind) {
        case 'TIP':
            return 'border-[#3ccf91] bg-[#16352b] text-[#76e0b1]';
        case 'IMPORTANT':
            return 'border-[#b794f6] bg-[#302545] text-[#d0b5ff]';
        case 'WARNING':
            return 'border-[#f2b84b] bg-[#3b2f19] text-[#ffd27a]';
        case 'CAUTION':
            return 'border-[#f06a72] bg-[#3d2025] text-[#ff9ba1]';
        default:
            return 'border-[#5ad7ff] bg-[#17323b] text-[#8ee5ff]';
    }
}

function formatAlertKind(kind: AlertKind): string {
    return kind.charAt(0) + kind.slice(1).toLowerCase();
}

function renderGuildNavigation(node: DashboardMarkdownNode): string {
    const roleSuffix = node.roleId ? `:${node.roleId}` : '';
    return `<${node.id ?? ''}:${node.navigation ?? ''}${roleSuffix}>`;
}

function toHexColor(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
}
