import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const docsLayoutOptions = {
    githubUrl: 'https://github.com/NeonTechSpace/NeonFlux',
    nav: {
        title: 'NeonFlux',
        url: '/',
    },
    links: [
        {
            text: 'Dashboard',
            url: '/dashboard',
            active: 'nested-url',
        },
    ],
} satisfies BaseLayoutProps;
