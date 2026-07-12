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
    fpsLimit: 45,
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
            color: '#79d9ff',
            distance: 152,
            enable: true,
            opacity: 0.28,
            width: 1,
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
                max: 0.78,
                min: 0.32,
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
                max: 3.4,
                min: 1.1,
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
                        ? 'dashboard-particle-field fixed -inset-[14dvh] hidden opacity-[0.92] blur-[2.4px] brightness-125 saturate-125 md:block'
                        : 'dashboard-particle-field fixed -inset-[14dvh] hidden opacity-[0.84] md:block'
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
