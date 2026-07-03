import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('/auth/convex', () => {
    it('registers Convex token and JWKS endpoints as concrete file routes', () => {
        const routeTree = readWebFile('src/routeTree.gen.ts');

        expect(routeTree).toContain("fullPath: '/.well-known/jwks.json'");
        expect(routeTree).toContain("fullPath: '/auth/convex/token'");
        expect(readWebFile('src/routes/[.]well-known.jwks[.]json.ts')).toContain(
            "createFileRoute('/.well-known/jwks.json')"
        );
        expect(readWebFile('src/routes/auth/convex/token.ts')).toContain("createFileRoute('/auth/convex/token')");
    });
});

function readWebFile(path: string): string {
    const candidates = [`apps/web/${path}`, path];
    const filePath = candidates.find((candidate) => existsSync(candidate));

    if (!filePath) {
        throw new Error(`Unable to find ${path}`);
    }

    return readFileSync(filePath, 'utf8');
}
