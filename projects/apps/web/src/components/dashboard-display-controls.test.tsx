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
            guildSelectorSortByName: false,
            particlesEnabled: true,
            particleBlurEnabled: true,
            reducedEffectsEnabled: false,
        });
        window.localStorage.clear();
    });

    it('reduces every decorative effect without erasing granular choices', () => {
        render(<DashboardDisplayControls variant='inline' />);

        fireEvent.click(screen.getByRole('button', { name: 'Reduce effects' }));

        expect(useDashboardDisplayPreferences.getState()).toMatchObject({
            particlesEnabled: true,
            particleBlurEnabled: true,
            reducedEffectsEnabled: true,
        });
        expect(
            screen.getByRole('button', {
                name: 'Particle controls unavailable while effects are reduced',
            })
        ).toHaveProperty('disabled', true);
        expect(
            screen.getByRole('button', {
                name: 'Particle blur unavailable while effects are reduced',
            })
        ).toHaveProperty('disabled', true);

        fireEvent.click(screen.getByRole('button', { name: 'Use full effects' }));

        expect(screen.getByRole('button', { name: 'Disable particles' })).toHaveProperty('disabled', false);
        expect(screen.getByRole('button', { name: 'Disable particle blur' })).toHaveProperty('disabled', false);
    });

    it('migrates existing granular preferences without opting users into reduced effects', async () => {
        window.localStorage.setItem(
            'neonflux-dashboard-display-preferences',
            JSON.stringify({
                state: {
                    desktopGuildSelectorOpen: true,
                    guildSelectorSortByName: true,
                    particlesEnabled: false,
                    particleBlurEnabled: false,
                },
                version: 2,
            })
        );

        await useDashboardDisplayPreferences.persist.rehydrate();

        expect(useDashboardDisplayPreferences.getState()).toMatchObject({
            desktopGuildSelectorOpen: true,
            guildSelectorSortByName: true,
            particlesEnabled: false,
            particleBlurEnabled: false,
            reducedEffectsEnabled: false,
        });
    });
});

describe('resolveDashboardDisplayEffects', () => {
    it('derives effective effects while preserving stored preferences', () => {
        expect(
            resolveDashboardDisplayEffects({
                particlesEnabled: true,
                particleBlurEnabled: true,
                reducedEffectsEnabled: true,
            })
        ).toStrictEqual({
            forceReducedMotion: true,
            particlesEnabled: false,
            particleBlurEnabled: false,
            transparencyEnabled: false,
        });

        expect(
            resolveDashboardDisplayEffects({
                particlesEnabled: false,
                particleBlurEnabled: true,
                reducedEffectsEnabled: false,
            })
        ).toStrictEqual({
            forceReducedMotion: false,
            particlesEnabled: false,
            particleBlurEnabled: false,
            transparencyEnabled: true,
        });
    });
});
