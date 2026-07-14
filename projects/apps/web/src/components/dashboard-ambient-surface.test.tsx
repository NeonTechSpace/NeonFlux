// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardAmbientSurface } from './dashboard-ambient-surface.js';
import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';
import type { DashboardDisplayPreferencesState } from './dashboard-display-preferences-store.js';

const rendererLifecycle = vi.hoisted(() => ({
    fluidMounted: vi.fn(),
    fluidUnmounted: vi.fn(),
    particleMounted: vi.fn(),
    particleUnmounted: vi.fn(),
}));

vi.mock('./dashboard-particle-field.js', async () => {
    const { useEffect } = await import('react');

    return {
        DashboardParticleField: () => {
            useEffect(() => {
                rendererLifecycle.particleMounted();

                return () => rendererLifecycle.particleUnmounted();
            }, []);

            return <div data-testid='particle-field' />;
        },
    };
});

vi.mock('./dashboard-fluid-field.js', async () => {
    const { useEffect } = await import('react');

    return {
        DashboardFluidField: ({ motionEnabled }: { motionEnabled: boolean }) => {
            useEffect(() => {
                rendererLifecycle.fluidMounted();

                return () => rendererLifecycle.fluidUnmounted();
            }, []);

            return <div data-testid='fluid-field' data-motion-enabled={String(motionEnabled)} />;
        },
    };
});

type MutableMediaQuery = {
    matches: boolean;
    listeners: Set<EventListenerOrEventListenerObject>;
};

const mediaQueries = new Map<string, MutableMediaQuery>();
let visibilityState: DocumentVisibilityState;

describe('DashboardAmbientSurface', () => {
    beforeEach(() => {
        visibilityState = 'visible';
        mediaQueries.clear();
        rendererLifecycle.fluidMounted.mockClear();
        rendererLifecycle.fluidUnmounted.mockClear();
        rendererLifecycle.particleMounted.mockClear();
        rendererLifecycle.particleUnmounted.mockClear();
        window.localStorage.clear();
        useDashboardDisplayPreferences.setState({
            fluidBlobsEnabled: true,
            particlesEnabled: true,
            reducedEffectsEnabled: false,
        });
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityState,
        });
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: (query: string): MediaQueryList => {
                const state = getMediaQuery(query);

                return {
                    get matches() {
                        return state.matches;
                    },
                    media: query,
                    onchange: null,
                    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) =>
                        state.listeners.add(listener),
                    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) =>
                        state.listeners.delete(listener),
                    addListener: () => undefined,
                    removeListener: () => undefined,
                    dispatchEvent: () => true,
                };
            },
        });
        setMediaQuery('(min-width: 768px)', true);
        setMediaQuery('(prefers-reduced-motion: reduce)', false);
    });

    it('removes both ambient renderers while hidden and restores them when visible', async () => {
        const view = render(<DashboardAmbientSurface />);

        const firstFluid = screen.getByTestId('fluid-field');
        const firstParticles = await screen.findByTestId('particle-field');
        expect(firstFluid.getAttribute('data-motion-enabled')).toBe('true');

        setDocumentVisibility('hidden');

        expect(screen.queryByTestId('fluid-field')).toBeNull();
        expect(screen.queryByTestId('particle-field')).toBeNull();
        expect(rendererLifecycle.fluidUnmounted).toHaveBeenCalledTimes(1);
        expect(rendererLifecycle.particleUnmounted).toHaveBeenCalledTimes(1);

        setDocumentVisibility('visible');

        const nextFluid = screen.getByTestId('fluid-field');
        const nextParticles = await screen.findByTestId('particle-field');
        expect(nextFluid).not.toBe(firstFluid);
        expect(nextParticles).not.toBe(firstParticles);
        expect(nextFluid.getAttribute('data-motion-enabled')).toBe('true');
        expect(rendererLifecycle.fluidMounted).toHaveBeenCalledTimes(2);
        expect(rendererLifecycle.particleMounted).toHaveBeenCalledTimes(2);
        view.unmount();
    });

    it('keeps fluid static on mobile or reduced effects and honors both renderer toggles', async () => {
        setMediaQuery('(min-width: 768px)', false);
        const view = render(<DashboardAmbientSurface />);

        expect(screen.getByTestId('fluid-field').getAttribute('data-motion-enabled')).toBe('false');
        expect(screen.queryByTestId('particle-field')).toBeNull();

        updateMediaQuery('(min-width: 768px)', true);
        await screen.findByTestId('particle-field');
        expect(screen.getByTestId('fluid-field').getAttribute('data-motion-enabled')).toBe('true');

        updatePreferences({ reducedEffectsEnabled: true });
        expect(screen.getByTestId('fluid-field').getAttribute('data-motion-enabled')).toBe('false');
        expect(screen.queryByTestId('particle-field')).toBeNull();

        updatePreferences({ reducedEffectsEnabled: false, particlesEnabled: false });
        expect(screen.getByTestId('fluid-field').getAttribute('data-motion-enabled')).toBe('true');
        expect(screen.queryByTestId('particle-field')).toBeNull();

        updatePreferences({ fluidBlobsEnabled: false, particlesEnabled: true });
        expect(screen.queryByTestId('fluid-field')).toBeNull();
        await screen.findByTestId('particle-field');
        view.unmount();
    });
});

function getMediaQuery(query: string): MutableMediaQuery {
    const existing = mediaQueries.get(query);

    if (existing) return existing;

    const state = { matches: false, listeners: new Set<EventListenerOrEventListenerObject>() };
    mediaQueries.set(query, state);
    return state;
}

function setMediaQuery(query: string, matches: boolean): void {
    getMediaQuery(query).matches = matches;
}

function updateMediaQuery(query: string, matches: boolean): void {
    const state = getMediaQuery(query);
    state.matches = matches;

    act(() => {
        const event = new Event('change');

        for (const listener of state.listeners) {
            if (typeof listener === 'function') listener(event);
            else listener.handleEvent(event);
        }
    });
}

function setDocumentVisibility(nextVisibility: DocumentVisibilityState): void {
    visibilityState = nextVisibility;
    fireEvent(document, new Event('visibilitychange'));
}

function updatePreferences(
    preferences: Partial<
        Pick<DashboardDisplayPreferencesState, 'fluidBlobsEnabled' | 'particlesEnabled' | 'reducedEffectsEnabled'>
    >
): void {
    act(() => useDashboardDisplayPreferences.setState(preferences));
}
