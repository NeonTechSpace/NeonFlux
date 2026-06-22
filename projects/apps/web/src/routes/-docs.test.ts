import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('/docs routing', () => {
    it('generates public docs and docs search routes', () => {
        const routeTree = readWebFile('src/routeTree.gen.ts');

        expect(routeTree).toContain("fullPath: '/docs'");
        expect(routeTree).toContain("fullPath: '/docs/topic'");
        expect(routeTree).toContain("fullPath: '/docs/topic/$'");
        expect(routeTree).toContain("fullPath: '/docs/api/search'");
        expect(routeTree).not.toContain("fullPath: '/api/search'");
    });

    it('keeps docs routes separate from dashboard and auth server boundaries', () => {
        const docsIndexRoute = readWebFile('src/routes/docs.tsx');
        const docsSplatRoute = readWebFile('src/routes/docs/topic/$.tsx');
        const searchRoute = readWebFile('src/routes/docs/api/search.ts');

        expect(`${docsIndexRoute}\n${docsSplatRoute}\n${searchRoute}`).not.toMatch(
            /dashboard\.server|web-session\.server|fluxer-auth-context|auth\/fluxer\/login/
        );
    });

    it('configures docs search under the docs route namespace', () => {
        const rootRoute = readWebFile('src/routes/__root.tsx');
        const searchRoute = readWebFile('src/routes/docs/api/search.ts');

        expect(rootRoute).toContain("api: '/docs/api/search'");
        expect(searchRoute).toContain("createFileRoute('/docs/api/search')");
    });

    it('forces the docs shell to dark mode', () => {
        const rootRoute = readWebFile('src/routes/__root.tsx');

        expect(rootRoute).toContain("className='dark'");
        expect(rootRoute).toContain("defaultTheme: 'dark'");
        expect(rootRoute).toContain("forcedTheme: 'dark'");
        expect(rootRoute).toContain('enableSystem: false');
    });

    it('includes starter docs content for current top-level concepts', () => {
        const docsIndex = readWebFile('content/docs/index.mdx');
        const instanceModes = readWebFile('content/docs/instance-modes.mdx');
        const docker = readWebFile('content/docs/docker.mdx');

        expect(docsIndex).toContain('NeonFlux is a Fluxer bot with a protected web dashboard.');
        expect(instanceModes).toContain('Single instance targets one configured community.');
        expect(docker).toContain('three services');
    });
});

function readWebFile(relativePath: string): string {
    return readFileSync(join(webRoot, relativePath), 'utf8');
}
