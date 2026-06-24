import { ArrowLeft, Github, LayoutDashboard } from 'lucide-react';
import type { DocsLayoutProps } from 'fumadocs-ui/layouts/docs';

export const docsLayoutOptions = {
    nav: {
        title: 'NeonFlux',
        url: '/docs/topic',
    },
    links: [
        {
            text: 'Dashboard',
            url: '/dashboard',
            icon: <LayoutDashboard className='size-4' aria-hidden='true' />,
            active: 'nested-url',
        },
        {
            text: 'Repository',
            url: 'https://github.com/NeonTechSpace/NeonFlux',
            icon: <Github className='size-4' aria-hidden='true' />,
            active: 'none',
            external: true,
        },
        {
            text: 'Back',
            url: '/',
            icon: <ArrowLeft className='size-4' aria-hidden='true' />,
            active: 'none',
        },
    ],
    themeSwitch: {
        enabled: false,
    },
} satisfies Omit<DocsLayoutProps, 'tree'>;
