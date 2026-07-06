import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { findMigrationEraPatternViolations } from './check-migration-era-patterns.js';

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('migration-era pattern guard', () => {
    it('flags migration-era Convex compatibility patterns', async () => {
        const root = await createWorkspaceRoot();

        await writeFile(
            join(root, 'packages', 'db', 'src', 'runtime.ts'),
            "import { api } from '@neonflux/convex/api';\nconst convexApi = api as unknown as { old: unknown };\nconvexApi.old;\nconst field = 'legacyId';\n"
        );

        const violations = await findMigrationEraPatternViolations(root);

        expect(violations.map((violation) => violation.label)).toEqual([
            'old Convex API package boundary',
            'runtime API shape cast',
            'convexApi facade access',
            'legacyId',
        ]);
    });

    it('ignores Convex generated output', async () => {
        const root = await createWorkspaceRoot();

        await mkdir(join(root, 'convex', '_generated'), { recursive: true });
        await writeFile(join(root, 'convex', '_generated', 'api.js'), 'export const api = anyApi;\n');

        await expect(findMigrationEraPatternViolations(root)).resolves.toEqual([]);
    });
});

async function createWorkspaceRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'neonflux-guard-'));

    tempRoots.push(root);
    await mkdir(join(root, 'apps'), { recursive: true });
    await mkdir(join(root, 'packages', 'db', 'src'), { recursive: true });
    await mkdir(join(root, 'convex'), { recursive: true });

    return root;
}
