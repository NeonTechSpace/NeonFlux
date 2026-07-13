import type { Engine, ISourceOptions } from '@tsparticles/engine';
import Particles, { ParticlesProvider } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';

const particleColors = ['#5ad7ff', '#5ad7ff', '#76a9ff', '#9d8cff', '#d86dff'];
const particleLinkDistance = 158;
const particleLinkHoverRadius = particleLinkDistance + 8;

const dashboardParticleOptions = createDashboardParticleOptions();

export function DashboardParticleField() {
    return (
        <ParticlesProvider init={loadDashboardParticles}>
            <Particles
                id='dashboard-particle-field'
                className='fixed inset-0 z-30 hidden size-full opacity-[0.88] md:block'
                options={dashboardParticleOptions}
            />
        </ParticlesProvider>
    );
}

function createDashboardParticleOptions() {
    return {
        autoPlay: true,
        background: {
            color: {
                value: 'transparent',
            },
        },
        detectRetina: false,
        fpsLimit: 45,
        fullScreen: {
            enable: false,
        },
        interactivity: {
            detectsOn: 'window',
            events: {
                onHover: {
                    enable: true,
                    mode: ['bubble', 'connect'],
                },
            },
            modes: {
                bubble: {
                    distance: 132,
                    duration: 0.35,
                    opacity: 0.96,
                    size: 5.2,
                },
                connect: {
                    distance: particleLinkDistance,
                    links: {
                        opacity: 0.62,
                    },
                    radius: particleLinkHoverRadius,
                },
            },
        },
        particles: {
            color: {
                value: particleColors,
            },
            links: {
                color: '#75d8ff',
                distance: particleLinkDistance,
                enable: true,
                opacity: 0.24,
                width: 0.9,
            },
            move: {
                direction: 'none',
                enable: true,
                outModes: {
                    default: 'out',
                },
                random: true,
                speed: {
                    max: 0.52,
                    min: 0.24,
                },
                straight: false,
            },
            number: {
                density: {
                    enable: true,
                    height: 900,
                    width: 1600,
                },
                value: 72,
            },
            opacity: {
                animation: {
                    enable: true,
                    speed: 0.14,
                    sync: false,
                },
                value: {
                    max: 0.82,
                    min: 0.34,
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
                    max: 3.2,
                    min: 0.9,
                },
            },
        },
        pauseOnBlur: true,
        pauseOnOutsideViewport: true,
        smooth: true,
    } satisfies ISourceOptions;
}

async function loadDashboardParticles(engine: Engine): Promise<void> {
    await loadSlim(engine);
}
