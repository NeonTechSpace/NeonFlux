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
    const [pageVisible, setPageVisible] = useState(true);
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
        const updatePageVisibility = () => setPageVisible(document.visibilityState !== 'hidden');

        updateDesktopMotionEnabled();
        updatePageVisibility();
        desktopMedia.addEventListener('change', updateDesktopMotionEnabled);
        reducedMotionMedia.addEventListener('change', updateDesktopMotionEnabled);
        document.addEventListener('visibilitychange', updatePageVisibility);

        return () => {
            desktopMedia.removeEventListener('change', updateDesktopMotionEnabled);
            reducedMotionMedia.removeEventListener('change', updateDesktopMotionEnabled);
            document.removeEventListener('visibilitychange', updatePageVisibility);
        };
    }, []);

    return (
        <div
            className='dashboard-ambient-surface pointer-events-none fixed inset-0 z-0 overflow-hidden'
            data-ambient-motion={effects.ambientMotionEnabled && pageVisible}
            aria-hidden='true'>
            <div className='dashboard-ambient-base absolute inset-0' />
            <div className='dashboard-ambient-fluid dashboard-ambient-fluid-cyan absolute' />
            <div className='dashboard-ambient-fluid dashboard-ambient-fluid-blue absolute' />
            <div className='dashboard-ambient-fluid dashboard-ambient-fluid-magenta absolute' />
            <div className='dashboard-ambient-fluid dashboard-ambient-fluid-violet absolute' />
            <div className='dashboard-ambient-current absolute' />
            <svg
                className='absolute inset-0 size-full opacity-[0.048] mix-blend-overlay'
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
            {effects.particlesEnabled && desktopMotionEnabled && pageVisible ? (
                <Suspense fallback={null}>
                    <DashboardParticleField blurEnabled={effects.particleBlurEnabled} />
                </Suspense>
            ) : null}
            <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_34%,rgba(5,7,17,0.08)_70%,rgba(4,5,13,0.35)_100%),linear-gradient(180deg,rgba(3,5,14,0.02),rgba(3,4,12,0.28))]' />
        </div>
    );
}
