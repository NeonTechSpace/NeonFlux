import { Blend, Sparkles } from 'lucide-react';

import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';

export function DashboardDisplayControls() {
    const particlesEnabled = useDashboardDisplayPreferences((state) => state.particlesEnabled);
    const particleBlurEnabled = useDashboardDisplayPreferences((state) => state.particleBlurEnabled);
    const setParticlesEnabled = useDashboardDisplayPreferences((state) => state.setParticlesEnabled);
    const setParticleBlurEnabled = useDashboardDisplayPreferences((state) => state.setParticleBlurEnabled);

    return (
        <div
            className='fixed top-7 right-[max(1rem,calc((100vw-1540px)/2))] z-30 hidden shrink-0 items-center gap-1 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(10,13,18,0.72)] p-1 shadow-[var(--dash-shadow-surface)] backdrop-blur lg:flex'
            aria-label='Display controls'>
            <button
                type='button'
                aria-label={particlesEnabled ? 'Disable particles' : 'Enable particles'}
                aria-pressed={particlesEnabled}
                onClick={() => setParticlesEnabled(!particlesEnabled)}
                className={getDisplayControlClassName(particlesEnabled)}>
                <Sparkles className='size-4' aria-hidden='true' />
            </button>
            <button
                type='button'
                aria-label={particleBlurEnabled ? 'Disable particle blur' : 'Enable particle blur'}
                aria-pressed={particleBlurEnabled}
                disabled={!particlesEnabled}
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
