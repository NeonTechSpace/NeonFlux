import type { Engine, ISourceOptions } from '@tsparticles/engine';
import Particles, { ParticlesProvider } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';

const particleColors = ['#00e5ff', '#22d3ee', '#ffea00', '#facc15', '#ff2bd6', '#ff4fd8'];

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
            color: {
                value: '#ffffff',
            },
            distance: 218,
            enable: true,
            opacity: 0.58,
            width: 1,
        },
        move: {
            direction: 'none',
            enable: true,
            outModes: {
                default: 'bounce',
            },
            random: false,
            speed: 0.38,
            straight: false,
        },
        number: {
            density: {
                enable: true,
                height: 1080,
                width: 1920,
            },
            value: 132,
        },
        opacity: {
            value: 0.64,
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
                max: 3.6,
                min: 1.75,
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
                        ? 'fixed -inset-[14dvh] hidden opacity-80 blur-[3px] md:block'
                        : 'fixed -inset-[14dvh] hidden opacity-80 md:block'
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
