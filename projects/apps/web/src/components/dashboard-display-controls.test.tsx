// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardDisplayControls } from './dashboard-display-controls.js';
import {
    resolveDashboardDisplayEffects,
    useDashboardDisplayPreferences,
} from './dashboard-display-preferences-store.js';

describe('DashboardDisplayControls', () => {
    afterEach(() => {
        useDashboardDisplayPreferences.setState({
            desktopGuildSelectorOpen: false,
            fluidBlobsEnabled: true,
            guildSelectorSortByName: false,
            particlesEnabled: true,
            reducedEffectsEnabled: false,
        });
        window.localStorage.clear();
    });

    it('reduces every decorative effect without erasing granular choices', () => {
        render(<DashboardDisplayControls variant='inline' />);

        fireEvent.click(screen.getByRole('button', { name: 'Reduce effects' }));

        expect(useDashboardDisplayPreferences.getState()).toMatchObject({
            fluidBlobsEnabled: true,
            particlesEnabled: true,
            reducedEffectsEnabled: true,
        });
        expect(
            screen.getByRole('button', {
                name: 'Particle controls unavailable while effects are reduced',
            })
        ).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByRole('button', { name: 'Use full effects' }));

        expect(screen.getByRole('button', { name: 'Disable particles' })).toHaveProperty('disabled', false);
    });

    it('toggles fluid blobs without changing particles', () => {
        render(<DashboardDisplayControls variant='inline' />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Disable fluid blobs' }).at(-1)!);

        expect(useDashboardDisplayPreferences.getState()).toMatchObject({
            fluidBlobsEnabled: false,
            particlesEnabled: true,
        });
        expect(screen.getAllByRole('button', { name: 'Enable fluid blobs' }).at(-1)?.getAttribute('aria-pressed')).toBe(
            'false'
        );
        expect(screen.getAllByRole('button', { name: 'Disable particles' }).at(-1)).toHaveProperty('disabled', false);
    });

    it('migrates existing granular preferences without opting users into reduced effects', async () => {
        window.localStorage.setItem(
            'neonflux-dashboard-display-preferences',
            JSON.stringify({
                state: {
                    desktopGuildSelectorOpen: true,
                    guildSelectorSortByName: true,
                    particlesEnabled: false,
                },
                version: 4,
            })
        );

        await useDashboardDisplayPreferences.persist.rehydrate();

        expect(useDashboardDisplayPreferences.getState()).toMatchObject({
            desktopGuildSelectorOpen: true,
            guildSelectorSortByName: true,
            fluidBlobsEnabled: true,
            particlesEnabled: false,
            reducedEffectsEnabled: false,
        });
    });
});

describe('resolveDashboardDisplayEffects', () => {
    it('derives effective effects while preserving stored preferences', () => {
        expect(
            resolveDashboardDisplayEffects({
                fluidBlobsEnabled: true,
                particlesEnabled: true,
                reducedEffectsEnabled: true,
            })
        ).toStrictEqual({
            forceReducedMotion: true,
            particlesEnabled: false,
            ambientMotionEnabled: false,
            fluidBlobsEnabled: true,
        });

        expect(
            resolveDashboardDisplayEffects({
                fluidBlobsEnabled: false,
                particlesEnabled: false,
                reducedEffectsEnabled: false,
            })
        ).toStrictEqual({
            forceReducedMotion: false,
            particlesEnabled: false,
            ambientMotionEnabled: true,
            fluidBlobsEnabled: false,
        });
    });
});
