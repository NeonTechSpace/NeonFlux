import { Blend, Sparkles } from 'lucide-react';

import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';

type DashboardDisplayControlsProps = {
    variant?: 'floating' | 'inline';
};

export function DashboardDisplayControls({ variant = 'floating' }: DashboardDisplayControlsProps) {
    const particlesEnabled = useDashboardDisplayPreferences((state) => state.particlesEnabled);
    const particleBlurEnabled = useDashboardDisplayPreferences((state) => state.particleBlurEnabled);
    const setParticlesEnabled = useDashboardDisplayPreferences((state) => state.setParticlesEnabled);
    const setParticleBlurEnabled = useDashboardDisplayPreferences((state) => state.setParticleBlurEnabled);
    const particlesLabel = particlesEnabled ? 'Disable particles' : 'Enable particles';
    const blurLabel = !particlesEnabled
        ? 'Particle blur unavailable while particles are disabled'
        : particleBlurEnabled
          ? 'Disable particle blur'
          : 'Enable particle blur';

    return (
        <div
            className={
                variant === 'floating'
                    ? 'fixed top-7 right-[max(1rem,calc((100vw-1540px)/2))] z-30 hidden shrink-0 items-center gap-1 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(10,13,18,0.72)] p-1 shadow-[var(--dash-shadow-surface)] backdrop-blur lg:flex'
                    : 'inline-flex h-10 shrink-0 items-center gap-1 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(10,13,18,0.72)] p-1 shadow-[var(--dash-shadow-surface)] backdrop-blur'
            }
            aria-label='Display controls'>
            <button
                type='button'
                aria-label={particlesLabel}
                aria-pressed={particlesEnabled}
                title={particlesLabel}
                onClick={() => setParticlesEnabled(!particlesEnabled)}
                className={getDisplayControlClassName(particlesEnabled)}>
                <Sparkles className='size-4' aria-hidden='true' />
            </button>
            <button
                type='button'
                aria-label={blurLabel}
                aria-pressed={particleBlurEnabled}
                disabled={!particlesEnabled}
                title={blurLabel}
                onClick={() => setParticleBlurEnabled(!particleBlurEnabled)}
                className={getDisplayControlClassName(particleBlurEnabled && particlesEnabled)}>
                <Blend className='size-4' aria-hidden='true' />
            </button>
        </div>
    );
}

function getDisplayControlClassName(active: boolean): string {
    const base =
        'grid size-8 place-items-center rounded-[var(--dash-radius-control)] border border-transparent transition focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

    return active
        ? `${base} bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]`
        : `${base} text-[var(--dash-text-muted)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)]`;
}
