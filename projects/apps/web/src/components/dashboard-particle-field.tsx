import type { Engine, ISourceOptions } from '@tsparticles/engine';
import Particles, { ParticlesProvider } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';

const particleColors = ['#5ad7ff', '#5ad7ff', '#76a9ff', '#9d8cff', '#d86dff', '#f5bd4f'];

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
    interactivity: {
        detectsOn: 'window',
        events: {
            onHover: {
                enable: true,
                mode: 'bubble',
            },
        },
        modes: {
            bubble: {
                distance: 112,
                duration: 0.35,
                opacity: 0.68,
                size: 3.8,
            },
        },
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
            speed: {
                max: 0.32,
                min: 0.16,
            },
            straight: false,
        },
        number: {
            density: {
                enable: false,
            },
            value: 84,
        },
        opacity: {
            value: {
                max: 0.54,
                min: 0.18,
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
                max: 3.1,
                min: 0.9,
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
                        ? 'dashboard-particle-field fixed -inset-[14dvh] hidden blur-[2.5px] md:block'
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
