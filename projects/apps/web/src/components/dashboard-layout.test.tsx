// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardRouteFrame } from './dashboard-layout.js';

const { ambientMounted, ambientUnmounted } = vi.hoisted(() => ({
    ambientMounted: vi.fn(),
    ambientUnmounted: vi.fn(),
}));

vi.mock('./dashboard-ambient-surface.js', async () => {
    const { useEffect } = await import('react');

    return {
        DashboardAmbientSurface: () => {
            useEffect(() => {
                ambientMounted();

                return () => ambientUnmounted();
            }, []);

            return <div data-testid='dashboard-ambient-surface' />;
        },
    };
});

describe('DashboardRouteFrame', () => {
    it('keeps the ambient renderers mounted while dashboard route content changes', () => {
        const view = render(
            <DashboardRouteFrame>
                <div>Choose server</div>
            </DashboardRouteFrame>
        );
        const ambientSurface = screen.getByTestId('dashboard-ambient-surface');

        view.rerender(
            <DashboardRouteFrame>
                <div>Selected server</div>
            </DashboardRouteFrame>
        );

        expect(screen.getByTestId('dashboard-ambient-surface')).toBe(ambientSurface);
        expect(ambientMounted).toHaveBeenCalledTimes(1);
        expect(ambientUnmounted).not.toHaveBeenCalled();

        view.unmount();
        expect(ambientUnmounted).toHaveBeenCalledTimes(1);
    });
});
