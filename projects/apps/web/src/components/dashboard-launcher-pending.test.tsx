// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardLauncherError, DashboardLauncherPending } from './dashboard-launcher-pending.js';

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({ invalidate: vi.fn() }),
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('dashboard launcher route states', () => {
    it('preserves launcher identity from cold loading through a retryable route failure', async () => {
        const view = render(<DashboardLauncherPending />);

        expect(screen.getByRole('heading', { name: 'Choose server' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Server launcher' })).toBeTruthy();
        expect(screen.getByRole('status', { name: 'Loading available servers' })).toBeTruthy();

        view.unmount();

        let settleRetry: (() => void) | undefined;
        const retry = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    settleRetry = resolve;
                })
        );
        render(<DashboardLauncherError onRetry={retry} />);

        expect(screen.getByRole('heading', { name: 'Choose server' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Server launcher' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry servers' }));

        expect(retry).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Retrying...' }).hasAttribute('disabled')).toBe(true);

        settleRetry?.();
        expect(await screen.findByRole('button', { name: 'Retry servers' })).toBeTruthy();
    });
});
