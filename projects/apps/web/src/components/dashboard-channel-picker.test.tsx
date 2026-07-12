// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';
import type { DashboardPickerChannel } from './dashboard-channel-picker.js';

const channels: DashboardPickerChannel[] = [
    { id: 'announcements', name: 'announcements', parentName: 'Community' },
    { id: 'general', name: 'general', parentName: 'Community' },
    { id: 'staff', name: 'staff', parentName: 'Private' },
];

function ChannelPickerHarness({ label, listboxId }: { label: string; listboxId: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedChannelId, setSelectedChannelId] = useState('');

    return (
        <>
            <DashboardChannelPicker
                channels={channels}
                hasError={false}
                isLoading={false}
                isOpen={isOpen}
                label={label}
                listboxId={listboxId}
                search={search}
                selectedChannelId={selectedChannelId}
                onBlur={() => setIsOpen(false)}
                onFocus={() => setIsOpen(true)}
                onSearchChange={(nextSearch) => {
                    setSearch(nextSearch);
                    setSelectedChannelId('');
                    setIsOpen(true);
                }}
                onSelect={(channel) => {
                    setSearch(formatDashboardChannelLabel(channel));
                    setSelectedChannelId(channel.id);
                    setIsOpen(false);
                }}
            />
            <output aria-label={`${label} selection`}>{selectedChannelId}</output>
        </>
    );
}

describe('DashboardChannelPicker', () => {
    beforeAll(() => {
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
            configurable: true,
            value: () => undefined,
        });
    });

    it('keeps input focus while navigating and selecting an active option with the keyboard', () => {
        render(<ChannelPickerHarness label='Keyboard channel' listboxId='keyboard-channel-options' />);
        const input = screen.getByRole('combobox', { name: 'Keyboard channel' });

        act(() => input.focus());
        fireEvent.keyDown(input, { key: 'ArrowDown' });

        expect(input.getAttribute('aria-activedescendant')).toBe('keyboard-channel-options-option-1');
        expect(input.matches(':focus')).toBe(true);
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(screen.getByRole('status', { name: 'Keyboard channel selection' }).textContent).toBe('general');
        expect((input as HTMLInputElement).value).toBe('#general');
        expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('supports result boundaries and closes the listbox with Escape', () => {
        render(<ChannelPickerHarness label='Boundary channel' listboxId='boundary-channel-options' />);
        const input = screen.getByRole('combobox', { name: 'Boundary channel' });

        act(() => input.focus());
        fireEvent.keyDown(input, { key: 'End' });
        expect(input.getAttribute('aria-activedescendant')).toBe('boundary-channel-options-option-2');

        fireEvent.keyDown(input, { key: 'Home' });
        expect(input.getAttribute('aria-activedescendant')).toBe('boundary-channel-options-option-0');

        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input.getAttribute('aria-expanded')).toBe('false');
        expect(input.matches(':focus')).toBe(false);
    });

    it('preserves pointer selection without transferring focus into an option', () => {
        render(<ChannelPickerHarness label='Pointer channel' listboxId='pointer-channel-options' />);
        const input = screen.getByRole('combobox', { name: 'Pointer channel' });

        act(() => input.focus());
        const option = screen.getByRole('option', { name: /#staff/i });
        expect(option.getAttribute('tabindex')).toBe('-1');
        fireEvent.mouseDown(option);
        fireEvent.click(option);

        expect(screen.getByRole('status', { name: 'Pointer channel selection' }).textContent).toBe('staff');
        expect((input as HTMLInputElement).value).toBe('#staff');
    });
});
