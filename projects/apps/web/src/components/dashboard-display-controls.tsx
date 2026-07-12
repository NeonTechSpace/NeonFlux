import { Blend, Gauge, Sparkles } from 'lucide-react';

import {
    resolveDashboardDisplayEffects,
    useDashboardDisplayPreferences,
} from './dashboard-display-preferences-store.js';

type DashboardDisplayControlsProps = {
    variant?: 'floating' | 'inline';
};

export function DashboardDisplayControls({ variant = 'floating' }: DashboardDisplayControlsProps) {
    const particlesEnabled = useDashboardDisplayPreferences((state) => state.particlesEnabled);
    const particleBlurEnabled = useDashboardDisplayPreferences((state) => state.particleBlurEnabled);
    const reducedEffectsEnabled = useDashboardDisplayPreferences((state) => state.reducedEffectsEnabled);
    const setParticlesEnabled = useDashboardDisplayPreferences((state) => state.setParticlesEnabled);
    const setParticleBlurEnabled = useDashboardDisplayPreferences((state) => state.setParticleBlurEnabled);
    const setReducedEffectsEnabled = useDashboardDisplayPreferences((state) => state.setReducedEffectsEnabled);
    const effects = resolveDashboardDisplayEffects({
        particleBlurEnabled,
        particlesEnabled,
        reducedEffectsEnabled,
    });
    const reduceEffectsLabel = reducedEffectsEnabled ? 'Use full effects' : 'Reduce effects';
    const particlesLabel = reducedEffectsEnabled
        ? 'Particle controls unavailable while effects are reduced'
        : particlesEnabled
          ? 'Disable particles'
          : 'Enable particles';
    const blurLabel = reducedEffectsEnabled
        ? 'Particle bloom unavailable while effects are reduced'
        : !particlesEnabled
          ? 'Particle bloom unavailable while particles are disabled'
          : particleBlurEnabled
            ? 'Use crisp particles'
            : 'Use particle bloom';

    return (
        <div
            className={
                variant === 'floating'
                    ? 'fixed top-7 right-[max(1rem,calc((100vw-1540px)/2))] z-30 hidden shrink-0 items-center gap-1 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-overlay-surface)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),var(--dash-shadow-surface)] backdrop-blur-[18px] backdrop-saturate-[1.28] lg:flex'
                    : 'inline-flex h-[3.25rem] shrink-0 items-center gap-1 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-overlay-surface)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),var(--dash-shadow-surface)] backdrop-blur-[18px] backdrop-saturate-[1.28]'
            }
            aria-label='Display effects'>
            <button
                type='button'
                aria-label={reduceEffectsLabel}
                aria-pressed={reducedEffectsEnabled}
                title={reduceEffectsLabel}
                onClick={() => setReducedEffectsEnabled(!reducedEffectsEnabled)}
                className={getDisplayControlClassName(reducedEffectsEnabled)}>
                <Gauge className='size-4' aria-hidden='true' />
            </button>
            <span className='mx-0.5 h-4 w-px bg-[var(--dash-border)]' aria-hidden='true' />
            <button
                type='button'
                aria-label={particlesLabel}
                aria-pressed={particlesEnabled}
                disabled={reducedEffectsEnabled}
                title={particlesLabel}
                onClick={() => setParticlesEnabled(!particlesEnabled)}
                className={getDisplayControlClassName(effects.particlesEnabled)}>
                <Sparkles className='size-4' aria-hidden='true' />
            </button>
            <button
                type='button'
                aria-label={blurLabel}
                aria-pressed={particleBlurEnabled}
                disabled={!effects.particlesEnabled}
                title={blurLabel}
                onClick={() => setParticleBlurEnabled(!particleBlurEnabled)}
                className={getDisplayControlClassName(effects.particleBlurEnabled)}>
                <Blend className='size-4' aria-hidden='true' />
            </button>
        </div>
    );
}

function getDisplayControlClassName(active: boolean): string {
    const base =
        'grid size-11 place-items-center rounded-[var(--dash-radius-control)] border border-transparent transition focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

    return active
        ? `${base} bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]`
        : `${base} text-[var(--dash-text-muted)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)]`;
}
