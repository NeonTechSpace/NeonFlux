import { Blend, Gauge, Sparkles, Waves } from 'lucide-react';

import {
    resolveDashboardDisplayEffects,
    useDashboardDisplayPreferences,
} from './dashboard-display-preferences-store.js';

type DashboardDisplayControlsProps = {
    variant?: 'floating' | 'inline' | 'navigation';
};

export function DashboardDisplayControls({ variant = 'floating' }: DashboardDisplayControlsProps) {
    const particlesEnabled = useDashboardDisplayPreferences((state) => state.particlesEnabled);
    const fluidBlobsEnabled = useDashboardDisplayPreferences((state) => state.fluidBlobsEnabled);
    const particleBlurEnabled = useDashboardDisplayPreferences((state) => state.particleBlurEnabled);
    const reducedEffectsEnabled = useDashboardDisplayPreferences((state) => state.reducedEffectsEnabled);
    const setParticlesEnabled = useDashboardDisplayPreferences((state) => state.setParticlesEnabled);
    const setFluidBlobsEnabled = useDashboardDisplayPreferences((state) => state.setFluidBlobsEnabled);
    const setParticleBlurEnabled = useDashboardDisplayPreferences((state) => state.setParticleBlurEnabled);
    const setReducedEffectsEnabled = useDashboardDisplayPreferences((state) => state.setReducedEffectsEnabled);
    const effects = resolveDashboardDisplayEffects({
        fluidBlobsEnabled,
        particleBlurEnabled,
        particlesEnabled,
        reducedEffectsEnabled,
    });
    const reduceEffectsLabel = reducedEffectsEnabled ? 'Use full effects' : 'Reduce effects';
    const blobsLabel = fluidBlobsEnabled ? 'Disable fluid blobs' : 'Enable fluid blobs';
    const particlesLabel = reducedEffectsEnabled
        ? 'Particle controls unavailable while effects are reduced'
        : particlesEnabled
          ? 'Disable particles'
          : 'Enable particles';
    const blurLabel = reducedEffectsEnabled
        ? 'Particle blur unavailable while effects are reduced'
        : !particlesEnabled
          ? 'Particle blur unavailable while particles are disabled'
          : particleBlurEnabled
            ? 'Use crisp particles'
            : 'Blur particles';

    return (
        <div className={getDisplayControlsClassName(variant)} aria-label='Display effects'>
            <button
                type='button'
                aria-label={reduceEffectsLabel}
                aria-pressed={reducedEffectsEnabled}
                title={reduceEffectsLabel}
                onClick={() => setReducedEffectsEnabled(!reducedEffectsEnabled)}
                className={getDisplayControlClassName(reducedEffectsEnabled, variant === 'navigation')}>
                <Gauge className='size-4' aria-hidden='true' />
            </button>
            <span
                className={
                    variant === 'navigation'
                        ? 'mx-0.5 h-4 w-px bg-white/[0.08]'
                        : 'mx-0.5 h-4 w-px bg-[var(--dash-border)]'
                }
                aria-hidden='true'
            />
            <button
                type='button'
                aria-label={blobsLabel}
                aria-pressed={fluidBlobsEnabled}
                title={blobsLabel}
                onClick={() => setFluidBlobsEnabled(!fluidBlobsEnabled)}
                className={getDisplayControlClassName(effects.fluidBlobsEnabled, variant === 'navigation')}>
                <Waves className='size-4' aria-hidden='true' />
            </button>
            <button
                type='button'
                aria-label={particlesLabel}
                aria-pressed={particlesEnabled}
                disabled={reducedEffectsEnabled}
                title={particlesLabel}
                onClick={() => setParticlesEnabled(!particlesEnabled)}
                className={getDisplayControlClassName(effects.particlesEnabled, variant === 'navigation')}>
                <Sparkles className='size-4' aria-hidden='true' />
            </button>
            <button
                type='button'
                aria-label={blurLabel}
                aria-pressed={particleBlurEnabled}
                disabled={!effects.particlesEnabled}
                title={blurLabel}
                onClick={() => setParticleBlurEnabled(!particleBlurEnabled)}
                className={getDisplayControlClassName(effects.particleBlurEnabled, variant === 'navigation')}>
                <Blend className='size-4' aria-hidden='true' />
            </button>
        </div>
    );
}

function getDisplayControlsClassName(variant: NonNullable<DashboardDisplayControlsProps['variant']>): string {
    switch (variant) {
        case 'floating':
            return 'fixed top-7 right-[max(1rem,calc((100vw-1540px)/2))] z-30 hidden shrink-0 items-center gap-1 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-overlay-surface)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),var(--dash-shadow-surface)] backdrop-blur-[18px] backdrop-saturate-[1.28] lg:flex';
        case 'inline':
            return 'inline-flex h-[3.25rem] shrink-0 items-center gap-1 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-overlay-surface)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),var(--dash-shadow-surface)] backdrop-blur-[18px] backdrop-saturate-[1.28]';
        case 'navigation':
            return 'inline-flex h-11 shrink-0 items-center gap-0.5 rounded-xl bg-white/[0.025] p-0.5';
    }
}

function getDisplayControlClassName(active: boolean, compact: boolean): string {
    const base = `grid ${compact ? 'size-10 rounded-xl' : 'size-11 rounded-[var(--dash-radius-control)] border border-transparent focus-visible:border-[var(--dash-primary)]'} place-items-center transition focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40`;

    return active
        ? `${base} bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]`
        : `${base} text-[var(--dash-text-muted)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)]`;
}
