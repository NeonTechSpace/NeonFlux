// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardFluxerMarkdown } from './dashboard-fluxer-markdown.js';
import { dashboardMarkdownMaximumLength, parseDashboardMarkdown } from './dashboard-fluxer-markdown-parser.js';

const roleId = '123456789012345678';
const colorlessRoleId = '123456789012345677';
const unknownRoleId = '123456789012345679';
const channelId = '223456789012345678';
const unknownChannelId = '223456789012345679';
const userId = '323456789012345678';
const emojiId = '423456789012345678';
const channels = [{ id: channelId, name: 'general', type: 0 }];
const emojis = [
    {
        animated: false,
        id: emojiId,
        markup: `<:neon:${emojiId}>`,
        name: 'neon',
        url: `https://fluxerusercontent.com/emojis/${emojiId}.png`,
    },
];
const roles = [
    { id: roleId, name: 'Operators', color: 0x5ad7ff },
    { id: colorlessRoleId, name: 'Members', color: 0 },
];
const renderedViews: RenderResult[] = [];

afterEach(() => {
    for (const view of renderedViews.splice(0)) view.unmount();
});

describe('DashboardFluxerMarkdown', () => {
    it('resolves custom emoji only from the live server catalog', () => {
        renderMarkdown(`<:neon:${emojiId}> <:other:523456789012345678>`);
        const image = screen.getByRole('img', { name: ':neon:' });
        expect(image.getAttribute('src')).toBe(emojis[0]?.url);
        expect(screen.getByText(/<:other:523456789012345678>/u)).toBeTruthy();
    });

    it('renders Fluxer text formatting, blocks, tables, alerts, timestamps, and accessible spoilers', () => {
        const source = [
            '# Heading',
            '**Bold** *italic* __underlined__ ~~removed~~ ||classified|| `inline`',
            '',
            '> Quoted',
            '',
            '> [!NOTE]',
            '> **Notice**',
            '',
            '- First',
            '- Second',
            '',
            '| Name | Value |',
            '| --- | --- |',
            '| Neon | Flux |',
            '',
            '```ts',
            'const enabled = true;',
            '```',
            '-# Supporting detail',
            '<t:1750000000:F>',
        ].join('\n');

        renderMarkdown(source);

        expect(screen.getByRole('heading', { name: 'Heading', level: 1 })).toBeTruthy();
        expect(screen.getByText('Bold').tagName).toBe('STRONG');
        expect(screen.getByText('italic').tagName).toBe('EM');
        expect(screen.getByText('underlined').tagName).toBe('U');
        expect(screen.getByText('removed').tagName).toBe('S');
        expect(screen.getByText('inline').tagName).toBe('CODE');
        expect(screen.getByRole('button', { name: 'Reveal spoiler' })).toBeTruthy();
        expect(screen.getByLabelText('Quote').textContent).toContain('Quoted');
        expect(screen.getByText('Note')).toBeTruthy();
        expect(screen.getByText('Notice').tagName).toBe('STRONG');
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('table')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'ts code block' }).textContent).toContain('const enabled = true;');
        expect(screen.getByText('Supporting detail').tagName).toBe('SMALL');
        expect(screen.getByText(/Sunday/u).getAttribute('datetime')).toBe('2025-06-15T15:06:40.000Z');

        fireEvent.click(screen.getByRole('button', { name: 'Reveal spoiler' }));
        expect(screen.queryByRole('button', { name: 'Reveal spoiler' })).toBeNull();
        expect(screen.getByLabelText('Revealed spoiler').textContent).toContain('classified');
    });

    it('renders ordinary safe links without unfurls and leaves unsafe targets non-interactive', () => {
        renderMarkdown('[Fluxer](https://fluxer.app) https://example.com [unsafe](javascript:alert(1))', 'standard');

        const masked = screen.getByRole<HTMLAnchorElement>('link', { name: 'Fluxer' });
        const raw = screen.getByRole<HTMLAnchorElement>('link', { name: 'https://example.com' });

        expect(masked.href).toBe('https://fluxer.app/');
        expect(masked.target).toBe('_blank');
        expect(masked.rel).toBe('noopener noreferrer');
        expect(masked.classList.contains('hover:underline')).toBe(true);
        expect(raw.href).toBe('https://example.com/');
        expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull();
        expect(screen.getByText('unsafe')).toBeTruthy();
    });

    it('resolves authorized role and channel mentions while retaining truthful fallbacks', () => {
        const source = [
            `<@&${roleId}>`,
            `<@&${colorlessRoleId}>`,
            `<@&${unknownRoleId}>`,
            `<#${channelId}>`,
            `<#${unknownChannelId}>`,
            `<@${userId}>`,
            `<@!${userId}>`,
            '@everyone',
            '@here',
            '<:wave:423456789012345678>',
        ].join(' ');

        renderMarkdown(source);

        const roleMention = screen.getByText('@Operators');
        expect(roleMention.style.color).toBe('rgb(90, 215, 255)');
        expect(screen.getByText('@Members').style.color).toBe('');
        expect(screen.getByText('@Unknown role')).toBeTruthy();
        expect(screen.getByText('#general')).toBeTruthy();
        expect(screen.getByText('#unknown-channel')).toBeTruthy();
        expect(screen.getAllByText(`@${userId}`)).toHaveLength(2);
        expect(screen.getByText('@everyone')).toBeTruthy();
        expect(screen.getByText('@here')).toBeTruthy();
        expect(screen.getByRole('img', { name: ':neon:' })).toBeTruthy();
    });

    it('supports nested formatting while preserving escaped syntax as text', () => {
        renderMarkdown('**outer _inner_** \\*literal\\*');

        const inner = screen.getByText('inner');
        expect(inner.tagName).toBe('EM');
        expect(inner.parentElement?.tagName).toBe('STRONG');
        expect(screen.getByText('*literal*')).toBeTruthy();
        expect(screen.queryByText('literal')).toBeNull();
    });

    it('does not parse mentions or formatting inside code', () => {
        const source = ['```', `**not bold** <@&${roleId}>`, '```'].join('\n');
        renderMarkdown(source);

        expect(screen.queryByText('@Operators')).toBeNull();
        expect(screen.getByText(`**not bold** <@&${roleId}>`).tagName).toBe('CODE');
    });

    it('applies the standard, embed, and restricted inline contexts', () => {
        const table = ['| A | B |', '| - | - |', '| C | D |'].join('\n');
        const { unmount } = renderMarkdown(table, 'standard');
        expect(screen.getByRole('table')).toBeTruthy();
        unmount();

        const { unmount: unmountEmbed } = renderMarkdown(table, 'embed');
        expect(screen.queryByRole('table')).toBeNull();
        expect(screen.getByText(/\| A/u)).toBeTruthy();
        unmountEmbed();

        renderMarkdown(['# Heading', '> Quote', '```ts', 'value', '```'].join('\n'), 'inline');
        expect(screen.queryByRole('heading')).toBeNull();
        expect(screen.queryByLabelText('Quote')).toBeNull();
        expect(screen.queryByRole('region', { name: /code block/u })).toBeNull();
        expect(screen.getByText(/# Heading/u)).toBeTruthy();
        expect(screen.getByText(/> Quote/u)).toBeTruthy();
        expect(screen.getByText('value').tagName).toBe('CODE');
    });

    it('preserves malformed and over-limit input as plain visible text', () => {
        const malformed = '**open [unfinished](';
        const view = renderMarkdown(malformed);
        expect(screen.getByText((content) => content.includes(malformed))).toBeTruthy();
        view.unmount();

        const oversized = 'x'.repeat(dashboardMarkdownMaximumLength + 1);
        renderMarkdown(oversized);
        expect(screen.getByText(oversized)).toBeTruthy();
        expect(screen.getByRole('status').textContent).toContain('showing plain text');
    });

    it('parses maximum message input within a bounded time', () => {
        const source = '*_~|['.repeat(1_200).slice(0, dashboardMarkdownMaximumLength);
        const startedAt = performance.now();
        const result = parseDashboardMarkdown(source, 'standard');
        const elapsed = performance.now() - startedAt;

        expect(result.type).toBe('parsed');
        expect(elapsed).toBeLessThan(1_000);
    });
});

function renderMarkdown(source: string, context: 'embed' | 'inline' | 'standard' = 'standard') {
    const view = render(
        <DashboardFluxerMarkdown source={source} context={context} channels={channels} emojis={emojis} roles={roles} />
    );
    renderedViews.push(view);
    return view;
}
