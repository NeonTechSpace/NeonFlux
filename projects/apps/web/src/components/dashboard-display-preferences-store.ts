import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { mutative } from 'zustand-mutative';

type DashboardDisplayPreferencesState = {
    desktopGuildSelectorOpen: boolean;
    guildSelectorSortByName: boolean;
    particlesEnabled: boolean;
    particleBlurEnabled: boolean;
    setDesktopGuildSelectorOpen: (open: boolean) => void;
    setGuildSelectorSortByName: (sortByName: boolean) => void;
    setParticlesEnabled: (enabled: boolean) => void;
    setParticleBlurEnabled: (enabled: boolean) => void;
};

export const useDashboardDisplayPreferences = create<DashboardDisplayPreferencesState>()(
    persist(
        mutative((set) => ({
            desktopGuildSelectorOpen: false,
            guildSelectorSortByName: false,
            particlesEnabled: true,
            particleBlurEnabled: true,
            setDesktopGuildSelectorOpen: (open) =>
                set((state) => {
                    state.desktopGuildSelectorOpen = open;
                }),
            setGuildSelectorSortByName: (sortByName) =>
                set((state) => {
                    state.guildSelectorSortByName = sortByName;
                }),
            setParticlesEnabled: (enabled) =>
                set((state) => {
                    state.particlesEnabled = enabled;
                }),
            setParticleBlurEnabled: (enabled) =>
                set((state) => {
                    state.particleBlurEnabled = enabled;
                }),
        })),
        {
            name: 'neonflux-dashboard-display-preferences',
            migrate: (persistedState) => ({
                desktopGuildSelectorOpen: readBoolean(persistedState, 'desktopGuildSelectorOpen', false),
                guildSelectorSortByName: readBoolean(persistedState, 'guildSelectorSortByName', false),
                particlesEnabled: readBoolean(persistedState, 'particlesEnabled', true),
                particleBlurEnabled: readBoolean(persistedState, 'particleBlurEnabled', true),
            }),
            partialize: (state) => ({
                desktopGuildSelectorOpen: state.desktopGuildSelectorOpen,
                guildSelectorSortByName: state.guildSelectorSortByName,
                particlesEnabled: state.particlesEnabled,
                particleBlurEnabled: state.particleBlurEnabled,
            }),
            version: 2,
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
