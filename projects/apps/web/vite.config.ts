import { defineConfig } from 'vite';
import babel from '@rolldown/plugin-babel';
import mdx from 'fumadocs-mdx/vite';
import { devtools } from '@tanstack/devtools-vite';

import { tanstackStart } from '@tanstack/react-start/plugin/vite';

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';

import { enforceBuildLogPolicy } from './vite-build-log-policy.js';

const config = defineConfig(({ mode }) => ({
    build: {
        // Lazy syntax grammars are intentionally isolated; the post-build guard enforces this byte ceiling exactly.
        chunkSizeWarningLimit: 900,
        rolldownOptions: {
            checks: {
                // This wall-clock heuristic is machine-load dependent and is not a correctness or size regression signal.
                pluginTimings: false,
            },
            onLog(level, log, defaultHandler) {
                enforceBuildLogPolicy(level, log, defaultHandler);
            },
        },
    },
    envDir: '../..',
    resolve: { tsconfigPaths: true },
    ssr: {
        external: ['tslib'],
    },
    plugins: [
        mdx(),
        mode === 'development' ? devtools() : undefined,
        nitro(),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        babel({
            presets: [reactCompilerPreset()],
        }),
    ],
}));

export default config;
