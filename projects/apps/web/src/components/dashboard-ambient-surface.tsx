import { lazy, Suspense, useEffect, useState } from 'react';

import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';

const DashboardParticleField = lazy(async () => {
    const module = await import('./dashboard-particle-field.js');

    return { default: module.DashboardParticleField };
});

export function DashboardAmbientSurface() {
    const particlesAllowed = useDashboardDisplayPreferences((state) => state.particlesEnabled);
    const particleBlurEnabled = useDashboardDisplayPreferences((state) => state.particleBlurEnabled);
    const [desktopMotionEnabled, setDesktopMotionEnabled] = useState(false);

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
        <div className='pointer-events-none fixed inset-0 z-0 overflow-hidden' aria-hidden='true'>
            <img
                src='/dashboard-ambient-bg.png'
                alt=''
                className='absolute inset-0 size-full object-cover'
                decoding='async'
                fetchPriority='high'
            />
            {particlesAllowed && desktopMotionEnabled ? (
                <Suspense fallback={null}>
                    <DashboardParticleField blurEnabled={particleBlurEnabled} />
                </Suspense>
            ) : null}
            <div className='absolute inset-0 bg-[linear-gradient(180deg,rgba(2,3,10,0.26),rgba(2,3,10,0.72)_34rem,#02030a_100%)]' />
        </div>
    );
}
