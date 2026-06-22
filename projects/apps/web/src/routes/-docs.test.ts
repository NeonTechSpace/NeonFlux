import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('/docs routing', () => {
    it('generates public docs and docs search routes', () => {
        const routeTree = readWebFile('src/routeTree.gen.ts');

        expect(routeTree).toContain("fullPath: '/docs'");
        expect(routeTree).toContain("fullPath: '/docs/$'");
        expect(routeTree).toContain("fullPath: '/api/search'");
    });

    it('keeps docs routes separate from dashboard and auth server boundaries', () => {
        const docsIndexRoute = readWebFile('src/routes/docs.tsx');
        const docsSplatRoute = readWebFile('src/routes/docs/$.tsx');
        const searchRoute = readWebFile('src/routes/api/search.ts');

        expect(`${docsIndexRoute}\n${docsSplatRoute}\n${searchRoute}`).not.toMatch(
            /dashboard\.server|web-session\.server|fluxer-auth-context|auth\/fluxer\/login/
        );
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
