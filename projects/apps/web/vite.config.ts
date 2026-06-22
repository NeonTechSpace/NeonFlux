import { defineConfig } from 'vite';
import babel from '@rolldown/plugin-babel';
import mdx from 'fumadocs-mdx/vite';
import { devtools } from '@tanstack/devtools-vite';

import { tanstackStart } from '@tanstack/react-start/plugin/vite';

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';

const config = defineConfig({
    resolve: { tsconfigPaths: true },
    plugins: [
        mdx(),
        devtools(),
        nitro(),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        babel({
            presets: [reactCompilerPreset()],
        }),
    ],
});

export default config;
