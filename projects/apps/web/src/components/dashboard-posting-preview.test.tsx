// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { Component, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardPostingPreview, MarkdownCodeLoadBoundary } from './dashboard-posting-preview.js';

const renderedViews: RenderResult[] = [];

afterEach(() => {
    for (const view of renderedViews.splice(0)) view.unmount();
});

describe('DashboardPostingPreview', () => {
    it('lazy-loads formatted content and renders complete embed text surfaces', async () => {
        renderedViews.push(
            render(
                <DashboardPostingPreview
                    channelLabel='#general'
                    channels={[{ id: '223456789012345678', name: 'general', type: 0 }]}
                    emojis={[]}
                    roles={[{ id: '123456789012345678', name: 'Operators', color: 0x5ad7ff }]}
                    content='Hello **team** <@&123456789012345678>'
                    embeds={[
                        {
                            author: {
                                name: 'NeonFlux',
                                url: 'https://example.com/author',
                            },
                            title: '**Release**',
                            url: 'https://example.com/release',
                            description: 'See [details](https://example.com/details).',
                            fields: [
                                { name: '**Status**', value: 'Ready', inline: true },
                                { name: 'Owner', value: '<#223456789012345678>', inline: true },
                                { name: 'Notes', value: 'No ~~known~~ blockers.' },
                            ],
                            footer: { text: 'Built by **NeonFlux**' },
                        },
                    ]}
                />
            )
        );

        expect(screen.getByRole('status').textContent).toContain('Loading formatted preview');
        expect(await screen.findByText('@Operators')).toBeTruthy();
        expect(screen.getByText('team').tagName).toBe('STRONG');
        expect(screen.getByRole('link', { name: 'NeonFlux' }).getAttribute('href')).toBe('https://example.com/author');
        const titleLink = screen.getByRole('link', { name: 'Release' });
        expect(titleLink.getAttribute('href')).toBe('https://example.com/release');
        expect(titleLink.classList.contains('hover:underline')).toBe(true);
        const detailsLink = screen.getByRole('link', { name: 'details' });
        expect(detailsLink.classList.contains('hover:underline')).toBe(true);
        expect(screen.getByText('Status').tagName).toBe('STRONG');
        const fieldList = screen.getByRole('list', { name: 'Embed fields' });
        const fieldItems = within(fieldList).getAllByRole('listitem');
        expect(fieldList.classList.contains('sm:grid-cols-3')).toBe(true);
        expect(fieldItems).toHaveLength(3);
        expect(fieldItems[0]?.classList.contains('sm:col-span-3')).toBe(false);
        expect(fieldItems[2]?.classList.contains('sm:col-span-3')).toBe(true);
        expect(screen.getAllByText('#general')).toHaveLength(2);
        expect(screen.getByText('known').tagName).toBe('S');
        expect(screen.getAllByText('NeonFlux').some((node) => node.tagName === 'STRONG')).toBe(true);
    });

    it('keeps unsafe embed author and title URLs non-interactive', async () => {
        renderedViews.push(
            render(
                <DashboardPostingPreview
                    channels={[]}
                    emojis={[]}
                    roles={[]}
                    content=''
                    embeds={[
                        {
                            author: { name: 'Unsafe author', url: 'javascript:alert(1)' },
                            title: 'Unsafe title',
                            url: 'data:text/html,unsafe',
                        },
                    ]}
                />
            )
        );

        expect(await screen.findByText('Unsafe author')).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'Unsafe author' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Unsafe title' })).toBeNull();
    });

    it('offers an actionable retry after formatted preview code fails to load', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderedViews.push(render(<RetryBoundaryHarness />));

        fireEvent.click(screen.getByRole('button', { name: 'Retry formatted preview' }));

        expect(screen.getByText('Formatted preview recovered.')).toBeTruthy();
        expect(errorSpy).toHaveBeenCalled();
    });
});

class ThrowingPreview extends Component {
    render(): never {
        throw new Error('fixture code-load failure');
    }
}

function RetryBoundaryHarness() {
    const [attempt, setAttempt] = useState(0);

    return (
        <MarkdownCodeLoadBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
            {attempt === 0 ? <ThrowingPreview /> : <p>Formatted preview recovered.</p>}
        </MarkdownCodeLoadBoundary>
    );
}
