import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { mutative } from 'zustand-mutative';

export type DashboardDisplayPreferencesState = {
    fluidBlobsEnabled: boolean;
    guildSelectorSortByName: boolean;
    particlesEnabled: boolean;
    reducedEffectsEnabled: boolean;
    setFluidBlobsEnabled: (enabled: boolean) => void;
    setGuildSelectorSortByName: (sortByName: boolean) => void;
    setParticlesEnabled: (enabled: boolean) => void;
    setReducedEffectsEnabled: (enabled: boolean) => void;
};

type DashboardDisplayEffectPreferences = Pick<
    DashboardDisplayPreferencesState,
    'fluidBlobsEnabled' | 'particlesEnabled' | 'reducedEffectsEnabled'
>;

export type EffectiveDashboardDisplayEffects = {
    ambientMotionEnabled: boolean;
    fluidBlobsEnabled: boolean;
    forceReducedMotion: boolean;
    particlesEnabled: boolean;
};

export function resolveDashboardDisplayEffects({
    fluidBlobsEnabled,
    particlesEnabled,
    reducedEffectsEnabled,
}: DashboardDisplayEffectPreferences): EffectiveDashboardDisplayEffects {
    const effectiveParticlesEnabled = particlesEnabled && !reducedEffectsEnabled;

    return {
        ambientMotionEnabled: !reducedEffectsEnabled,
        fluidBlobsEnabled,
        forceReducedMotion: reducedEffectsEnabled,
        particlesEnabled: effectiveParticlesEnabled,
    };
}

export const useDashboardDisplayPreferences = create<DashboardDisplayPreferencesState>()(
    persist(
        mutative((set) => ({
            fluidBlobsEnabled: true,
            guildSelectorSortByName: false,
            particlesEnabled: true,
            reducedEffectsEnabled: false,
            setFluidBlobsEnabled: (enabled) =>
                set((state) => {
                    state.fluidBlobsEnabled = enabled;
                }),
            setGuildSelectorSortByName: (sortByName) =>
                set((state) => {
                    state.guildSelectorSortByName = sortByName;
                }),
            setParticlesEnabled: (enabled) =>
                set((state) => {
                    state.particlesEnabled = enabled;
                }),
            setReducedEffectsEnabled: (enabled) =>
                set((state) => {
                    state.reducedEffectsEnabled = enabled;
                }),
        })),
        {
            name: 'neonflux-dashboard-display-preferences',
            migrate: (persistedState) => ({
                fluidBlobsEnabled: readBoolean(persistedState, 'fluidBlobsEnabled', true),
                guildSelectorSortByName: readBoolean(persistedState, 'guildSelectorSortByName', false),
                particlesEnabled: readBoolean(persistedState, 'particlesEnabled', true),
                reducedEffectsEnabled: readBoolean(persistedState, 'reducedEffectsEnabled', false),
            }),
            partialize: (state) => ({
                fluidBlobsEnabled: state.fluidBlobsEnabled,
                guildSelectorSortByName: state.guildSelectorSortByName,
                particlesEnabled: state.particlesEnabled,
                reducedEffectsEnabled: state.reducedEffectsEnabled,
            }),
            version: 6,
        }
    )
);

function readBoolean(value: unknown, key: string, fallback: boolean): boolean {
    if (typeof value !== 'object' || value === null) {
        return fallback;
    }

    const candidate = (value as Record<string, unknown>)[key];

    return typeof candidate === 'boolean' ? candidate : fallback;
}
