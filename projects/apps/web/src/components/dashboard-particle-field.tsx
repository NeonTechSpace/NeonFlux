import type { Engine, ISourceOptions } from '@tsparticles/engine';
import Particles, { ParticlesProvider } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';

const particleColors = ['#5ad7ff', '#78defe', '#9d8cff'];

const dashboardParticleOptions = {
    autoPlay: true,
    background: {
        color: {
            value: 'transparent',
        },
    },
    detectRetina: true,
    fpsLimit: 60,
    fullScreen: {
        enable: false,
    },
    particles: {
        color: {
            value: particleColors,
        },
        links: {
            enable: false,
        },
        move: {
            direction: 'none',
            enable: true,
            outModes: {
                default: 'out',
            },
            random: true,
            speed: 0.18,
            straight: false,
        },
        number: {
            density: {
                enable: false,
            },
            value: 52,
        },
        opacity: {
            value: {
                max: 0.46,
                min: 0.16,
            },
        },
        paint: {
            color: {
                value: particleColors,
            },
            fill: {
                enable: true,
            },
        },
        shape: {
            type: 'circle',
        },
        size: {
            value: {
                max: 2.4,
                min: 1,
            },
        },
    },
    pauseOnBlur: true,
    pauseOnOutsideViewport: true,
    smooth: true,
} satisfies ISourceOptions;

export function DashboardParticleField({ blurEnabled }: { blurEnabled: boolean }) {
    return (
        <ParticlesProvider init={loadDashboardParticles}>
            <Particles
                id='dashboard-particle-field'
                className={
                    blurEnabled
                        ? 'dashboard-particle-field fixed -inset-[14dvh] hidden blur-[2px] md:block'
                        : 'dashboard-particle-field fixed -inset-[14dvh] hidden md:block'
                }
                style={{
                    height: '128dvh',
                    width: '128vw',
                }}
                options={dashboardParticleOptions}
            />
        </ParticlesProvider>
    );
}

async function loadDashboardParticles(engine: Engine): Promise<void> {
    await loadSlim(engine);
}
