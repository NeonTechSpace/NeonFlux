import { lazy, Suspense, useEffect, useId, useState } from 'react';

import {
    resolveDashboardDisplayEffects,
    useDashboardDisplayPreferences,
} from './dashboard-display-preferences-store.js';

const DashboardParticleField = lazy(async () => {
    const module = await import('./dashboard-particle-field.js');

    return { default: module.DashboardParticleField };
});

export function DashboardAmbientSurface() {
    const particlesEnabled = useDashboardDisplayPreferences((state) => state.particlesEnabled);
    const particleBlurEnabled = useDashboardDisplayPreferences((state) => state.particleBlurEnabled);
    const reducedEffectsEnabled = useDashboardDisplayPreferences((state) => state.reducedEffectsEnabled);
    const [desktopMotionEnabled, setDesktopMotionEnabled] = useState(false);
    const noiseFilterId = `dashboard-ambient-noise-${useId().replaceAll(':', '')}`;
    const effects = resolveDashboardDisplayEffects({
        particleBlurEnabled,
        particlesEnabled,
        reducedEffectsEnabled,
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }

        const desktopMedia = window.matchMedia('(min-width: 768px)');
        const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updateDesktopMotionEnabled = () => {
            setDesktopMotionEnabled(desktopMedia.matches && !reducedMotionMedia.matches);
        };

        updateDesktopMotionEnabled();
        desktopMedia.addEventListener('change', updateDesktopMotionEnabled);
        reducedMotionMedia.addEventListener('change', updateDesktopMotionEnabled);

        return () => {
            desktopMedia.removeEventListener('change', updateDesktopMotionEnabled);
            reducedMotionMedia.removeEventListener('change', updateDesktopMotionEnabled);
        };
    }, []);

    return (
        <div
            className='dashboard-ambient-surface pointer-events-none fixed inset-0 z-0 overflow-hidden'
            aria-hidden='true'>
            <div className='dashboard-ambient-base absolute inset-0' />
            {effects.transparencyEnabled ? (
                <>
                    <div className='dashboard-ambient-aurora dashboard-ambient-aurora-cyan absolute' />
                    <div className='dashboard-ambient-aurora dashboard-ambient-aurora-violet absolute' />
                    <svg
                        className='dashboard-ambient-noise absolute inset-0 size-full'
                        focusable='false'
                        preserveAspectRatio='none'>
                        <filter id={noiseFilterId} x='-20%' y='-20%' width='140%' height='140%'>
                            <feTurbulence
                                type='fractalNoise'
                                baseFrequency='0.82'
                                numOctaves='3'
                                seed='17'
                                stitchTiles='stitch'
                            />
                            <feColorMatrix type='saturate' values='0' />
                        </filter>
                        <rect width='100%' height='100%' filter={`url(#${noiseFilterId})`} />
                    </svg>
                </>
            ) : null}
            {effects.particlesEnabled && desktopMotionEnabled ? (
                <Suspense fallback={null}>
                    <DashboardParticleField blurEnabled={effects.particleBlurEnabled} />
                </Suspense>
            ) : null}
            <div className='dashboard-ambient-vignette absolute inset-0' />
        </div>
    );
}
